const { SETTING_TYPES, formatValue } = require('./site-settings');
const { at } = require('./site-sets');

const YAML_SELECTOR = [{ scheme: 'file', language: 'yaml' }, { scheme: 'vscode-remote', language: 'yaml' }];
const isYaml = (document) => !!document && /\.ya?ml$/.test(document.uri.path) && ['file', 'vscode-remote'].includes(document.uri.scheme);
const rangeOf = (vscode, item) => new vscode.Range(item.line, item.start, item.endLine ?? item.line, item.end);

function settingMarkdown(vscode, name, matches, context) {
  const content = new vscode.MarkdownString();
  const scope = context?.site ? `Site ${context.site.id}` : context?.currentSet ? `Set ${context.currentSet.name}` : 'Project';
  content.appendText(`${name}\n\n${scope} · Static file configuration (TYPO3 runtime overrides are not evaluated).\n\n`);
  for (const match of matches.slice(0, 10)) {
    const schema = match.schema || (match.isDefault ? match : undefined);
    content.appendText(`${match.effective ? 'Selected value' : match.isDefault ? 'Default' : match.origin || 'Definition'}${schema?.settingType ? ` · ${schema.settingType}` : ''}${schema?.readonly ? ' · read-only in TYPO3 editor' : ''}\n`);
    if (schema?.description || match.description) content.appendText(`${schema?.description || match.description}\n`);
    if (schema?.enumValues) content.appendText(`Allowed: ${Object.keys(schema.enumValues).join(', ')}\n`);
    content.appendCodeblock(`${match.path}: ${formatValue(match.rawValue) ?? match.value?.trim() ?? '(no default)'}`, 'yaml');
    content.appendMarkdown(`[${match.uri.path.split('/').at(-1)}:${match.line + 1}](<${match.uri.toString()}#L${match.line + 1}>)\n\n`);
  }
  return content;
}

function createSiteSetFeatures(vscode, project) {
  const service = project.siteSets;
  async function inspect(document, token) {
    if (!isYaml(document) || token?.isCancellationRequested) return;
    const data = await service.settings(document, token);
    const model = data.models.get(document.uri.toString());
    if (model && !token?.isCancellationRequested) return { data, model };
  }
  async function definition(document, position, token) {
    const inspected = await inspect(document, token);
    if (!inspected) return [];
    const { data, model } = inspected;
    const ref = model.references?.find((item) => at(item, position));
    if (ref) return (data.context.registry.all.filter((set) => set.name === ref.name))
      .map((set) => new vscode.Location(set.uri, rangeOf(vscode, set.nameLocation)));
    const imported = model.imports.find((item) => at(item, position));
    if (imported) return (await service.resolveYamlImport(document.uri, imported, data.context.registry)).uris
      .map((uri) => new vscode.Location(uri, new vscode.Range(0, 0, 0, 0)));
    const setting = model.definitions.find((item) => at(item, position));
    if (!setting) return [];
    return data.definitions.filter((item) => item.path === setting.path && item.isDefault)
      .map((item) => new vscode.Location(item.uri, rangeOf(vscode, item)));
  }
  async function links(document, token) {
    const inspected = await inspect(document, token);
    if (!inspected) return [];
    const result = [];
    for (const ref of inspected.model.references || []) {
      const matches = inspected.data.context.registry.all.filter((set) => set.name === ref.name);
      if (matches.length === 1) result.push(new vscode.DocumentLink(rangeOf(vscode, ref), matches[0].uri));
    }
    for (const item of inspected.model.imports) {
      const resolved = await service.resolveYamlImport(document.uri, item, inspected.data.context.registry);
      if (resolved.uris.length === 1) result.push(new vscode.DocumentLink(rangeOf(vscode, item), resolved.uris[0]));
    }
    return result;
  }
  async function hover(document, position, token) {
    const inspected = await inspect(document, token);
    if (!inspected) return;
    const { data, model } = inspected, ref = model.references?.find((item) => at(item, position));
    if (ref) {
      const set = data.context.registry.all.find((entry) => entry.name === ref.name);
      if (!set) return;
      const content = new vscode.MarkdownString();
      content.appendText(`${set.name}${set.label ? ` · ${set.label}` : ''}\n\n${ref.optional ? 'Optional' : 'Required'} site set${set.hidden ? ' · hidden from TYPO3 selector' : ''}\n\n`);
      content.appendText(`Load order: ${service.closure(data.context.registry, [set.name]).map((entry) => entry.name).join(' → ') || 'Invalid dependencies'}`);
      return new vscode.Hover(content, rangeOf(vscode, ref));
    }
    const node = model.definitions.find((item) => at(item, position) || at(item.valueLocation, position));
    if (!node) return;
    const matches = data.definitions.filter((entry) => entry.path === node.path);
    return new vscode.Hover(settingMarkdown(vscode, node.path, matches.length ? matches : [{ ...node, uri: document.uri }], data.context), rangeOf(vscode, node));
  }
  async function completion(document, position, token) {
    const inspected = await inspect(document, token);
    if (!inspected) return [];
    const { data, model } = inspected;
    const lines = document.getText().split(/\r\n|\r|\n/), prefix = lines[position.line].slice(0, position.character);
    if (/^\s*#/.test(prefix)) return [];
    const indent = prefix.match(/^\s*/)[0].length;
    const parents = [];
    let depth = indent;
    for (let line = position.line - 1; line >= 0 && depth > 0; line--) {
      const match = lines[line].match(/^(\s*)([a-zA-Z0-9_.-]+):(?:\s|$)/);
      if (match && match[1].length < depth) { parents.unshift(match[2]); depth = match[1].length; }
    }
    const list = prefix.match(/^\s*-\s*["']?([a-zA-Z0-9_./-]*)$/);
    if (list && ['dependencies', 'optionalDependencies'].includes(parents.at(-1))) {
      const existing = new Set((model.references || []).filter((item) => item.line !== position.line).map((item) => item.name));
      const end = position.character + lines[position.line].slice(position.character).match(/^[a-zA-Z0-9_./-]*/)[0].length;
      return [...data.context.registry.sets.values()].filter((set) => set.name !== model.name && !existing.has(set.name)
        && set.name.startsWith(list[1])).map((set) => {
        const item = new vscode.CompletionItem(set.name, vscode.CompletionItemKind.Module);
        item.detail = `${set.label || 'Site set'}${set.hidden ? ' · hidden' : ''}`;
        item.range = new vscode.Range(position.line, position.character - list[1].length, position.line, end);
        item.insertText = set.name; return item;
      });
    }
    const property = prefix.match(/^\s*([a-zA-Z0-9_.-]+):\s*(.*)$/);
    const typeItems = (values, start, detail, end = position.character) => values.map((value) => {
      const item = new vscode.CompletionItem(String(value), vscode.CompletionItemKind.Value);
      item.insertText = String(value); item.detail = detail;
      item.range = new vscode.Range(position.line, start, position.line, end); return item;
    });
    if (property) {
      const start = position.character - property[2].length;
      const parent = parents.reduce((map, key) => model.field(map, key)?.value, model.map);
      const value = model.field(parent, property[1])?.value;
      const location = value && model.location(value);
      const end = location?.endLine === position.line ? Math.max(position.character, location.end) : position.character;
      if (model.kind === 'definitions' && property[1] === 'type') return typeItems(SETTING_TYPES, start, 'TYPO3 setting type', end);
      if (['hidden', 'readonly'].includes(property[1]) && (model.kind === 'definitions' || model.kind === 'set')) return typeItems(['true', 'false'], start, 'Boolean', end);
      const node = model.definitions.find((item) => item.line === position.line || at(item.valueLocation, position));
      const schema = node && (data.schemas.get(node.path) || node.isDefault && node);
      const values = schema?.enumValues ? Object.keys(schema.enumValues).map((value) => JSON.stringify(value))
        : schema?.settingType === 'bool' ? ['true', 'false'] : schema?.settingType === 'stringlist' ? ['[]'] : [];
      if (values.length) return typeItems(values, start, schema.description || schema.settingType, end);
    }
    const key = prefix.match(/^\s*([a-zA-Z0-9_.-]*)$/);
    if (!key) return [];
    const start = position.character - key[1].length;
    const end = position.character + lines[position.line].slice(position.character).match(/^[a-zA-Z0-9_.-]*/)[0].length;
    const hasColon = /^\s*:/.test(lines[position.line].slice(end));
    const keyItems = (names, detail) => typeItems(names.map((name) => hasColon ? name : `${name}: `), start, detail, end);
    if (!indent && model.kind === 'set') return keyItems(['name', 'label', 'dependencies', 'optionalDependencies', 'hidden'], 'Site set configuration');
    if (model.kind === 'definitions') return parents[0] === 'settings' && parents.length > 1
      ? keyItems(['type', 'default', 'label', 'description', 'category', 'enum', 'readonly'], 'Setting definition') : [];
    const base = model.kind === 'config' || model.kind === 'site' ? parents[0] === 'settings' ? parents.slice(1) : null : parents;
    if (!base) return [];
    const pathPrefix = base.length ? `${base.join('.')}.` : '';
    return [...data.schemas.values()].filter((schema) => schema.path.startsWith(pathPrefix + key[1])).map((schema) => {
      const name = schema.path.slice(pathPrefix.length), item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Property);
      item.detail = `${schema.settingType}${schema.readonly ? ' · read-only in TYPO3 editor' : ''}`; item.documentation = schema.description;
      item.range = new vscode.Range(position.line, start, position.line, end);
      item.insertText = hasColon ? name : `${name}: ${JSON.stringify(schema.rawValue) ?? ''}`; return item;
    });
  }
  async function references(document, position, context, token) {
    const inspected = await inspect(document, token);
    if (!inspected) return [];
    const { data, model } = inspected;
    const ref = model.references?.find((item) => at(item, position));
    const declared = model.name && at(model.nameLocation, position);
    const name = ref?.name || (declared ? model.name : undefined);
    if (name) {
      const results = [...data.context.registry.models.values()].flatMap((entry) => (entry.references || [])
        .filter((item) => item.name === name).map((item) => new vscode.Location(entry.uri, rangeOf(vscode, item))));
      if (context.includeDeclaration) results.push(...data.context.registry.all.filter((entry) => entry.name === name)
        .map((entry) => new vscode.Location(entry.uri, rangeOf(vscode, entry.nameLocation))));
      return results;
    }
    const setting = model.definitions.find((item) => at(item, position));
    if (!setting) return [];
    const results = (await project.allSources(document, token)).flatMap((source) => source.parsed.references.filter((item) => item.name === setting.path)
      .map((item) => new vscode.Location(source.uri, rangeOf(vscode, item))));
    if (context.includeDeclaration) results.push(...data.definitions.filter((item) => item.path === setting.path).map((item) => new vscode.Location(item.uri, rangeOf(vscode, item))));
    return results;
  }
  return { inspect, completion, hover, definition, references,
    subscriptions: [
      vscode.languages.registerDefinitionProvider(YAML_SELECTOR, { provideDefinition: definition }),
      vscode.languages.registerReferenceProvider(YAML_SELECTOR, { provideReferences: references }),
      vscode.languages.registerDocumentLinkProvider(YAML_SELECTOR, { provideDocumentLinks: links }),
      vscode.languages.registerHoverProvider(YAML_SELECTOR, { provideHover: hover }),
      vscode.languages.registerCompletionItemProvider(YAML_SELECTOR, { provideCompletionItems: completion }, ':', '.', '/', ' ')
    ]
  };
}

module.exports = { createSiteSetFeatures, YAML_SELECTOR, isYaml, settingMarkdown, rangeOf };
