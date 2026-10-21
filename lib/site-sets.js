const path = require('node:path').posix;
const { inspectConfig, inspectSettings, validateSetting, formatValue } = require('./site-settings');

const keyOf = (uri) => uri.toString();
const directoryOf = (uri) => uri.with({ path: path.dirname(uri.path), query: '', fragment: '' });
const contains = (root, uri) => root.scheme === uri.scheme && root.authority === uri.authority
  && (root.path === uri.path || uri.path.startsWith(root.path.replace(/\/$/, '') + '/'));
const at = (item, position) => item.line === position.line && item.start <= position.character
  && (item.endLine > position.line || item.end >= position.character);

// TYPO3 orders the entire registry before selecting a site's dependency closure.
// Optional edges are added only when they do not introduce a cycle.
function orderSets(sets) {
  const names = [...sets.keys()].sort(), edges = new Map(names.map((name) => [name, new Set()]));
  for (const name of names) for (const ref of sets.get(name).references) if (!ref.optional && sets.has(ref.name)) edges.get(name).add(ref.name);
  const reaches = (from, target, seen = new Set()) => {
    if (from === target) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return [...edges.get(from) || []].some((name) => reaches(name, target, seen));
  };
  for (const name of names) for (const ref of sets.get(name).references) {
    if (ref.optional && sets.has(ref.name) && !reaches(ref.name, name)) edges.get(name).add(ref.name);
  }
  const incoming = new Map(names.map((name) => [name, 0]));
  for (const dependencies of edges.values()) for (const name of dependencies) incoming.set(name, incoming.get(name) + 1);
  const roots = names.filter((name) => !incoming.get(name)), result = [];
  while (roots.length) {
    roots.sort((a, b) => edges.get(a).size - edges.get(b).size || (a < b ? 1 : a > b ? -1 : 0));
    const name = roots.shift(); result.push(sets.get(name));
    for (const dependency of edges.get(name)) {
      incoming.set(dependency, incoming.get(dependency) - 1);
      if (!incoming.get(dependency)) roots.push(dependency);
    }
  }
  return result.reverse();
}

function createSiteSets(vscode, options, state) {
  const registries = new Map(), settingsCache = new Map(), texts = new Map(), watches = new Map();
  const selections = { ...state?.get('typoscriptHighlighting.siteContexts', {}) };
  let disposed = false;
  const cancelled = (token) => token?.isCancellationRequested;
  const clear = () => { registries.clear(); settingsCache.clear(); texts.clear(); };
  function watch(base, pattern) {
    const key = `${keyOf(base)}|${pattern}`;
    if (disposed || watches.has(key) || watches.size >= 600) return;
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(base, pattern));
    const changed = () => { clear(); options.onChange(); };
    const subscriptions = [watcher, watcher.onDidCreate(changed), watcher.onDidChange(changed), watcher.onDidDelete(changed)];
    watches.set(key, subscriptions);
  }
  function text(uri) {
    const key = keyOf(uri);
    if (!texts.has(key)) texts.set(key, options.readText(uri));
    return texts.get(key);
  }
  async function directories(root) {
    try {
      return (await vscode.workspace.fs.readDirectory(root)).filter(([name, type]) => !name.startsWith('.')
        && (type & (vscode.FileType.Directory | (vscode.FileType.SymbolicLink || 0)))).map(([name]) => vscode.Uri.joinPath(root, name));
    } catch { return []; }
  }
  async function registry(document) {
    const info = await options.contextFor(document);
    const key = [info.root, info.webRoot, info.vendorRoot, info.coreRoot].filter(Boolean).map(keyOf).join('|');
    if (!registries.has(key)) registries.set(key, (async () => {
      const extensions = await options.extensionRoots(info.root, info);
      const extensionDirectories = [...new Map([info.root, ...extensions.values()].map((uri) => [keyOf(uri), uri])).values()];
      for (const dir of extensionDirectories.slice(0, 300)) {
        try { if ((await vscode.workspace.fs.stat(dir)).type & vscode.FileType.Directory) watch(dir, 'Configuration/Sets/**/*.{yaml,yml,typoscript,tsconfig}'); } catch { /* Absent extension root. */ }
      }
      const setRoots = extensionDirectories.slice(0, 300).map((uri) => vscode.Uri.joinPath(uri, 'Configuration/Sets'));
      const composerSites = vscode.Uri.joinPath(info.root, 'config/sites');
      const classicSites = vscode.Uri.joinPath(info.webRoot, 'typo3conf/sites');
      const siteRoots = info.installation === 'composer' ? [composerSites] : info.installation === 'classic' ? [classicSites] : [composerSites, classicSites];
      const setDirectories = [], siteDirectories = [];
      for (const [roots, target] of [[setRoots, setDirectories], [siteRoots, siteDirectories]]) {
        for (let index = 0; index < roots.length && target.length < 500; index += 16) {
          const groups = await Promise.all(roots.slice(index, index + 16).map(async (root) => {
            const found = await directories(root);
            // Existing bases also work on the minimum supported VS Code version.
            if (found.length) watch(root, '**/*.{yaml,yml,typoscript,tsconfig}');
            return found;
          }));
          for (const group of groups) target.push(...group);
        }
      }
      const all = [], sites = [], models = new Map();
      for (const [dirs, target, kind] of [[setDirectories, all, 'set'], [siteDirectories, sites, 'site']]) {
        const unique = [...new Map(dirs.map((uri) => [keyOf(uri), uri])).values()].slice(0, 500);
        for (let index = 0; index < unique.length; index += 16) {
          const entries = await Promise.all(unique.slice(index, index + 16).map(async (dir) => {
            const uri = vscode.Uri.joinPath(dir, 'config.yaml'), source = await text(uri);
            if (source === null && (kind === 'set' || await text(vscode.Uri.joinPath(dir, 'settings.yaml')) === null)) return null;
            const model = inspectConfig(source || '', kind);
            const entry = { ...model, uri, dir, id: path.basename(dir.path), kind };
            models.set(keyOf(uri), entry);
            return entry;
          }));
          target.push(...entries.filter(Boolean));
        }
      }
      // Site config imports are resolved before determining the dependency graph.
      // Set config and setting definitions intentionally do not process imports.
      let configLoads = 0;
      async function siteReferences(model, stack = []) {
        const result = [], key = keyOf(model.uri);
        if (++configLoads > 500 || stack.length >= 32) return [];
        for (const item of model.imports) {
          const resolved = await resolveYamlImport(model.uri, item, { extensions });
          if (!resolved.uris.length && !item.ignoreMissing) model.issues.push({ ...item, code: 'yaml-import', severity: 'warning', message: `YAML import could not be resolved: ${resolved.reason}.` });
          for (const uri of resolved.uris) {
            if ([...stack, key].includes(keyOf(uri))) { model.issues.push({ ...item, code: 'cyclic-yaml-import', severity: 'error', message: 'Cyclic YAML import.' }); continue; }
            let imported = models.get(keyOf(uri));
            if (!imported) { imported = { ...inspectConfig(await text(uri) || '', 'site'), uri }; models.set(keyOf(uri), imported); }
            watch(directoryOf(uri), '*.{yaml,yml}');
            result.push(...await siteReferences(imported, [...stack, key]));
          }
        }
        return [...result, ...model.references.map((ref) => ({ ...ref, uri: model.uri }))];
      }
      for (const site of sites) site.resolvedReferences = await siteReferences(site);
      const groups = new Map(), sets = new Map();
      for (const entry of all) if (entry.name) {
        if (!groups.has(entry.name)) groups.set(entry.name, []);
        groups.get(entry.name).push(entry);
      }
      for (const [name, entries] of groups) {
        if (entries.length === 1 && !entries[0].issues.some((issue) => issue.severity === 'error')) sets.set(name, entries[0]);
        else if (entries.length > 1) for (const entry of entries) entry.issues.push({ ...entry.nameLocation, code: 'duplicate-set',
          message: `Set name ${name} is declared more than once. Use a unique name.`, severity: 'error' });
      }
      const invalid = new Set(), done = new Set();
      function valid(name, stack = []) {
        if (done.has(name)) return !invalid.has(name);
        if (stack.includes(name)) {
          const cycle = [...stack.slice(stack.indexOf(name)), name];
          for (let index = 0; index < cycle.length - 1; index++) {
            invalid.add(cycle[index]);
            const entry = sets.get(cycle[index]), ref = entry.references.find((item) => !item.optional && item.name === cycle[index + 1]);
            entry.issues.push({ ...ref, code: 'cyclic-set', message: `Cyclic required dependencies: ${cycle.join(' → ')}.`, severity: 'error' });
          }
          return false;
        }
        const entry = sets.get(name);
        if (!entry) return false;
        for (const ref of entry.references.filter((item) => !item.optional)) {
          if (!valid(ref.name, [...stack, name])) {
            invalid.add(name);
            entry.issues.push({ ...ref, code: 'missing-set',
              message: `Required set ${ref.name} is missing, ambiguous or has invalid dependencies.`, severity: 'error' });
          }
        }
        done.add(name); return !invalid.has(name);
      }
      for (const name of sets.keys()) valid(name);
      for (const name of invalid) sets.delete(name);
      for (const entry of sites) for (const ref of entry.resolvedReferences) {
        if (!ref.optional && !sets.has(ref.name)) models.get(keyOf(ref.uri)).issues.push({ ...ref, code: 'missing-set', message: `Required set ${ref.name} is missing, ambiguous or invalid.`, severity: 'error' });
      }
      return { key, info, extensions, all, sets, sites, models, ordered: orderSets(sets), limited: setDirectories.length > 500 || siteDirectories.length > 500 };
    })());
    return registries.get(key);
  }
  function closure(registry, names) {
    const wanted = new Set();
    function visit(name) {
      if (wanted.has(name) || !registry.sets.has(name)) return;
      wanted.add(name);
      for (const ref of registry.sets.get(name).references) visit(ref.name);
    }
    names.forEach(visit);
    return registry.ordered.filter((entry) => wanted.has(entry.name));
  }
  async function context(document) {
    const found = await registry(document);
    const currentSet = found.all.find((entry) => contains(entry.dir, document.uri));
    let site = found.sites.find((entry) => contains(entry.dir, document.uri)), selected = false;
    if (!site && selections[keyOf(found.info.root)]) {
      site = found.sites.find((entry) => keyOf(entry.dir) === selections[keyOf(found.info.root)]);
      selected = !!site;
    }
    if (!site && currentSet) {
      const applicable = found.sites.filter((entry) => closure(found, (entry.resolvedReferences || entry.references).map((ref) => ref.name)).some((set) => set.name === currentSet.name));
      if (applicable.length === 1) site = applicable[0];
    }
    if (!site && !currentSet && found.sites.length === 1) site = found.sites[0];
    const roots = site ? (site.resolvedReferences || site.references).map((ref) => ref.name) : currentSet ? [currentSet.name] : [];
    return { registry: found, site, currentSet, selected, roots, sets: closure(found, roots),
      kind: site ? 'site' : currentSet ? 'set' : found.sites.length > 1 ? 'ambiguous' : 'none' };
  }
  async function select(document, siteUri) {
    const found = await registry(document), key = keyOf(found.info.root);
    if (siteUri && !found.sites.some((site) => keyOf(site.dir) === keyOf(siteUri))) return false;
    if (siteUri) selections[key] = keyOf(siteUri); else delete selections[key];
    const entries = Object.entries(selections).slice(-100);
    await state?.update('typoscriptHighlighting.siteContexts', Object.fromEntries(entries));
    settingsCache.clear(); options.onChange(); return true;
  }
  async function resolveYamlImport(uri, item, found) {
    const resource = item.path?.replace(/\\/g, '/');
    if (!resource || resource.includes('\0') || /%[^%]+%|\$\{|^[a-z]+:\/\//i.test(resource)) return { uris: [], reason: 'Only static local YAML resources can be resolved' };
    let base = directoryOf(uri), relative = resource;
    if (resource.startsWith('EXT:')) {
      const match = resource.match(/^EXT:([a-zA-Z0-9_]+)\/(.*)$/);
      base = match && found.extensions.get(match[1]); relative = match?.[2];
      if (!base) return { uris: [], reason: 'Extension was not found in this project' };
    } else if (resource.startsWith('/') || /^[a-z]:\//i.test(resource)) { base = uri.with({ path: '/' }); relative = resource.replace(/^\//, ''); }
    if (/[?{}\[\]]/.test(relative) || path.dirname(relative).includes('*')) return { uris: [], reason: 'Use a static path or a filename wildcard' };
    const target = vscode.Uri.joinPath(base, relative);
    if (relative.includes('*') && !item.glob) return { uris: [], reason: 'Wildcard YAML imports require glob: true' };
    if (!relative.includes('*')) return { uris: await text(target) !== null ? [target] : [], reason: 'Resource was not found' };
    const regex = new RegExp(`^${path.basename(relative).split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
    try {
      const names = (await vscode.workspace.fs.readDirectory(directoryOf(target))).filter(([name, type]) => (type & vscode.FileType.File) && regex.test(name)).map(([name]) => name).sort().slice(0, 200);
      return { uris: names.map((name) => vscode.Uri.joinPath(directoryOf(target), name)), reason: 'No resources matched' };
    } catch { return { uris: [], reason: 'Resource directory was not found' }; }
  }
  async function collectSettings(scope) {
    const found = scope.registry, models = new Map(found.models), issues = new Map();
    const history = [], schemas = new Map();
    let loaded = 0;
    const addIssues = (uri, entries) => {
      const key = keyOf(uri);
      if (!issues.has(key)) issues.set(key, []);
      issues.get(key).push(...entries);
    };
    for (const model of models.values()) addIssues(model.uri, model.issues);
    async function load(uri, kind, stack = []) {
      const source = await text(uri);
      if (source === null) return [];
      const key = keyOf(uri);
      if (stack.length >= 32 || loaded >= 500) { addIssues(uri, [{ line: 0, start: 0, end: 1, code: 'yaml-limit', severity: 'warning', message: 'YAML import analysis limit reached.' }]); return []; }
      loaded++;
      const model = kind === 'config' && models.has(key) ? models.get(key) : { ...inspectSettings(source, uri.path, kind), uri };
      models.set(key, model); addIssues(uri, model.issues);
      watch(directoryOf(uri), '*.{yaml,yml}');
      const result = [];
      for (const item of model.imports) {
        const resolved = await resolveYamlImport(uri, item, found);
        if (!resolved.uris.length && !item.ignoreMissing) addIssues(uri, [{ ...item, code: 'yaml-import', severity: 'warning', message: `YAML import could not be resolved: ${resolved.reason}.` }]);
        for (const target of resolved.uris) {
          if ([...stack, key].includes(keyOf(target))) { addIssues(uri, [{ ...item, code: 'cyclic-yaml-import', severity: 'error', message: 'Cyclic YAML import.' }]); continue; }
          result.push(...await load(target, kind === 'config' ? 'config' : 'settings', [...stack, key]));
        }
      }
      result.push(...[...model.definitions.filter((node) => !node.flatKey), ...model.definitions.filter((node) => node.flatKey)].map((node) => ({ ...node, uri })));
      return result;
    }
    function append(nodes, defaults = false) {
      const local = new Map();
      for (let node of nodes.slice(0, Math.max(0, 20000 - history.length))) {
        const previous = local.get(node.path);
        if (Array.isArray(previous?.rawValue) && Array.isArray(node.rawValue)) {
          const rawValue = [...previous.rawValue, ...node.rawValue].slice(0, 2000);
          node = { ...node, rawValue, value: ` ${formatValue(rawValue)}`, origin: 'Site setting (merged YAML list)' };
        }
        local.set(node.path, node);
        if (defaults) schemas.set(node.path, node);
        const schema = schemas.get(node.path), message = schema && validateSetting(schema, node);
        if (message) addIssues(node.uri, [{ ...node.valueLocation, code: 'setting-value', message, severity: 'warning' }]);
        history.push({ ...node, schema, valid: !schema || !validateSetting(schema, node, false) });
      }
    }
    for (const set of scope.sets) {
      append(await load(vscode.Uri.joinPath(set.dir, 'settings.definitions.yaml'), 'definitions'), true);
      // A settings.yaml file replaces inline values from the set configuration.
      const uri = vscode.Uri.joinPath(set.dir, 'settings.yaml');
      append(await text(uri) === null ? set.definitions.map((node) => ({ ...node, uri: set.uri })) : await load(uri, 'settings'));
    }
    if (scope.site) {
      const uri = vscode.Uri.joinPath(scope.site.dir, 'settings.yaml');
      append(await text(uri) === null ? await load(scope.site.uri, 'config') : await load(uri, 'settings'));
    }
    // Inspect the edited set even when its dependency graph is invalid.
    if (scope.currentSet && !scope.sets.includes(scope.currentSet)) {
      await load(vscode.Uri.joinPath(scope.currentSet.dir, 'settings.definitions.yaml'), 'definitions');
      await load(vscode.Uri.joinPath(scope.currentSet.dir, 'settings.yaml'), 'settings');
    }
    for (const model of models.values()) {
      const entries = issues.get(keyOf(model.uri));
      if (entries) issues.set(keyOf(model.uri), entries.filter((item, index) => entries.findIndex((other) => other.line === item.line && other.start === item.start && other.code === item.code && other.message === item.message) === index));
    }
    const effective = new Map();
    for (const node of history) if (node.valid && node.rawValue !== undefined) effective.set(node.path, node);
    const definitions = history.reverse().map((node) => ({ ...node, effective: effective.get(node.path) === node }));
    return { context: scope, definitions, effective: [...effective.values()], schemas, models, issues };
  }
  async function settings(document, token) {
    if (cancelled(token) || !['file', 'vscode-remote'].includes(document.uri.scheme)) return { definitions: [], effective: [], schemas: new Map(), models: new Map(), issues: new Map() };
    const scope = await context(document), key = `${scope.registry.key}|${scope.site?.dir || ''}|${scope.currentSet?.dir || ''}`;
    if (!settingsCache.has(key)) settingsCache.set(key, collectSettings(scope));
    const result = await settingsCache.get(key);
    return cancelled(token) ? { ...result, definitions: [], effective: [] } : result;
  }
  function allowed(scope, uri) {
    const set = scope.registry.all.find((entry) => contains(entry.dir, uri));
    if (set) return scope.sets.includes(set) || set === scope.currentSet;
    if (/\/Configuration\/Sets\/[^/]+\//.test(uri.path)) return false;
    const site = scope.registry.sites.find((entry) => contains(entry.dir, uri));
    return !site || site === scope.site;
  }
  async function implicit(document, token) {
    if (cancelled(token)) return [];
    const scope = await context(document), tsconfig = document.uri.path.endsWith('.tsconfig');
    const names = tsconfig ? ['page.tsconfig'] : /(?:^|\/)constants(?:\.[^/]*)?\.(?:typoscript|txt)$/.test(document.uri.path)
      ? ['constants.typoscript'] : ['constants.typoscript', 'setup.typoscript'];
    const result = [];
    for (const set of scope.sets) for (const name of names) {
      const override = set.value(set.field(set.map, tsconfig ? 'pagets' : 'typoscript')?.value);
      let base = set.dir;
      if (typeof override === 'string') {
        if (override.startsWith('EXT:')) {
          const match = override.match(/^EXT:([a-zA-Z0-9_]+)\/(.*)$/);
          const extension = match && scope.registry.extensions.get(match[1]);
          if (!extension) continue;
          base = vscode.Uri.joinPath(extension, match[2]);
        } else base = override.startsWith('/') ? set.uri.with({ path: override }) : vscode.Uri.joinPath(set.dir, override);
      }
      const uri = tsconfig && typeof override === 'string' ? base : vscode.Uri.joinPath(base, name);
      try { if ((await vscode.workspace.fs.stat(uri)).type & vscode.FileType.File) result.push(uri); } catch { /* Optional implicit files. */ }
    }
    if (scope.site) for (const name of names) {
      const uri = vscode.Uri.joinPath(scope.site.dir, name);
      try { if ((await vscode.workspace.fs.stat(uri)).type & vscode.FileType.File) result.push(uri); } catch { /* Optional site files. */ }
    }
    return result;
  }
  return { registry, context, select, settings, implicit, allowed, resolveYamlImport, closure, clear, at,
    dispose() { disposed = true; clear(); for (const subscriptions of watches.values()) subscriptions.forEach((item) => item.dispose()); watches.clear(); }
  };
}

module.exports = { createSiteSets, orderSets, contains, at };
