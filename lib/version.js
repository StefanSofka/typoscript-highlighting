const path = require('path').posix;

const TYPO3_PACKAGES = ['typo3/cms-core', 'typo3/cms'];

function parseMajorVersion(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^v?(\d+)(?:\.(?:\d+|x)){0,3}(?:[-+][\w.-]+)?$/i);
  const major = match ? Number(match[1]) : null;
  return Number.isSafeInteger(major) ? major : null;
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

// Only accept constraints whose complete range proves one comment-rule family.
// Unsupported branches and ranges spanning the v11/v12 boundary stay unknown.
function parseConstraintMajor(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const families = [];
  for (const alternative of value.split(/\|\|?/)) {
    let lower = [0, 0, 0];
    let upper = [Infinity, 0, 0];
    let lowerInclusive = true;
    let upperInclusive = false;
    const bound = (version, isLower, inclusive) => {
      const comparison = compare(version, isLower ? lower : upper);
      if (isLower && comparison > 0) {
        lower = version;
        lowerInclusive = inclusive;
      } else if (!isLower && comparison < 0) {
        upper = version;
        upperInclusive = inclusive;
      } else if (comparison === 0) {
        if (isLower) lowerInclusive = lowerInclusive && inclusive;
        else upperInclusive = upperInclusive && inclusive;
      }
    };
    const expression = alternative.trim().replace(/@(dev|alpha|beta|rc|stable)\b/gi, '')
      .replace(/(>=|<=|>|<|=|\^|~)\s+/g, '$1');
    const hyphen = expression.match(/^(\d+(?:\.\d+){0,2})\s+-\s+(\d+(?:\.\d+){0,2})$/);
    const tokens = hyphen ? [`>=${hyphen[1]}`, `<=${hyphen[2]}`] : expression.split(/[\s,]+/);
    for (const token of tokens) {
      const match = token.match(/^(>=|<=|>|<|=|\^|~)?v?(\d+|\*|x)(?:\.(\d+|\*|x))?(?:\.(\d+|\*|x))?(?:-(?:dev|alpha\d*|beta\d*|RC\d*))?$/i);
      if (!match) return null;
      const operator = match[1] || '=';
      const parts = match.slice(2, 5).filter((part) => part !== undefined);
      const wildcard = parts.findIndex((part) => /^(\*|x)$/i.test(part));
      if (wildcard >= 0 && (operator !== '=' || parts.slice(wildcard).some((part) => !/^(\*|x)$/i.test(part)))) return null;
      if (wildcard === 0) continue;
      const version = [0, 0, 0];
      parts.slice(0, wildcard < 0 ? parts.length : wildcard).forEach((part, i) => { version[i] = Number(part); });
      if (version.some((part) => !Number.isSafeInteger(part))) return null;
      if (wildcard > 0 || operator === '^' || operator === '~') {
        bound(version, true, true);
        const end = [...version];
        let index = wildcard > 0 ? wildcard - 1 : 0;
        if (operator === '^') index = version.findIndex((part) => part > 0);
        if (operator === '~') index = parts.length >= 3 ? 1 : 0;
        if (index < 0) index = parts.length - 1;
        end[index]++;
        for (let i = index + 1; i < 3; i++) end[i] = 0;
        bound(end, false, false);
      } else if (operator === '=' || operator === '<=') {
        bound(version, false, true);
        if (operator === '=') bound(version, true, true);
      } else if (operator === '<') bound(version, false, /-(?:dev|alpha|beta|rc)/i.test(token));
      else bound(version, true, operator === '>=');
    }
    const ordering = compare(lower, upper);
    if (ordering > 0 || (ordering === 0 && !(lowerInclusive && upperInclusive))) return null;
    if (lower[0] >= 12) families.push(lower[0]);
    else if (lower[0] === 11 && (compare(upper, [12, 0, 0]) < 0 || (compare(upper, [12, 0, 0]) === 0 && !upperInclusive))) families.push(11);
    else return null;
  }
  if (families.every((major) => major === 11)) return 11;
  if (families.every((major) => major >= 12)) return Math.min(...families);
  return null;
}

function majorFromLock(data) {
  const packages = [...(Array.isArray(data?.packages) ? data.packages : []),
    ...(Array.isArray(data?.['packages-dev']) ? data['packages-dev'] : [])];
  for (const name of TYPO3_PACKAGES) {
    const major = parseMajorVersion(packages.find((entry) => entry?.name === name)?.version);
    if (major >= 11) return major;
  }
  return null;
}

function majorFromManifest(data) {
  for (const name of TYPO3_PACKAGES) {
    const value = data?.require?.[name] ?? data?.['require-dev']?.[name];
    if (value !== undefined) return parseConstraintMajor(value);
  }
  return null;
}

function hasTypo3Package(data, lockfile = false) {
  if (lockfile) {
    return ['packages', 'packages-dev'].some((key) => Array.isArray(data?.[key])
      && data[key].some((entry) => TYPO3_PACKAGES.includes(entry?.name)));
  }
  return TYPO3_PACKAGES.some((name) => data?.require?.[name] !== undefined || data?.['require-dev']?.[name] !== undefined);
}

const CORE_VERSION_FILE = 'Classes/Information/Typo3Version.php';
// Shallow discovery remains cheap even when looking above the workspace.
const DISCOVERY_PATTERN = '{composer.json,composer.lock,typo3,typo3_src,vendor,public,web,htdocs,typo3conf,config}';
const missing = (error) => ['FileNotFound', 'ENOENT', 'FileNotADirectory', 'ENOTDIR', 'FileIsADirectory', 'EISDIR'].includes(error.code);

function parseCoreVersion(text) {
  if (typeof text !== 'string' || text.length > 512 * 1024) return null;
  // Lex only enough PHP to locate a literal class constant. Never execute PHP,
  // inspect string contents as code, or accept a version from a comment.
  const tokens = (text.match(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|#[^\r\n]*|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|[a-zA-Z_]\w*|[^\s]/g) || [])
    .filter((token) => !/^(?:\/\*|\/\/|#)/.test(token));
  let namespace = '', depth = 0, classDepth = -1;
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index] === 'namespace') {
      namespace = '';
      while (++index < tokens.length && ![';', '{'].includes(tokens[index])) namespace += tokens[index];
    }
    if (tokens[index] === 'class' && tokens[index + 1] === 'Typo3Version' && namespace === 'TYPO3\\CMS\\Core\\Information') {
      while (++index < tokens.length && tokens[index] !== '{') { /* skip inheritance */ }
      classDepth = depth + 1;
    }
    if (tokens[index] === '{') depth++;
    else if (tokens[index] === '}') { if (depth === classDepth) classDepth = -1; depth--; }
    else if (depth === classDepth && tokens[index] === 'const') {
      let cursor = index + 1;
      while (cursor < tokens.length && !['=', ';', '{'].includes(tokens[cursor])) cursor++;
      if (tokens[cursor - 1] !== 'VERSION' || tokens[cursor] !== '=' || tokens[cursor + 2] !== ';') continue;
      const literal = tokens[cursor + 1]?.match(/^(['"])(v?\d+(?:\.\d+){1,3}(?:[-+][\w.-]+)?)\1$/i);
      if (literal && parseMajorVersion(literal[2]) !== null) return literal[2];
    }
  }
  return null;
}

function createVersionDetector(vscode, watchDirectory = () => {}, report = () => {}) {
  const cache = new Map();
  const join = (uri, value) => vscode.Uri.joinPath(uri, value);
  function resolve(uri, value, fallback) {
    const selected = typeof value === 'string' && value && !/[\0%$]/.test(value) ? value.replace(/\\/g, '/') : fallback;
    return uri.with({ path: path.resolve(uri.path, /^[a-zA-Z]:\//.test(selected) ? `/${selected}` : selected) });
  }
  async function readText(uri, onUnreadable) {
    try { return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8'); }
    catch (error) { if (!missing(error)) { report(error); onUnreadable?.(); } return null; }
  }
  async function readJson(uri) {
    const text = await readText(uri);
    try { return text === null ? null : JSON.parse(text); } catch { return null; }
  }
  async function exists(uri) {
    try { return !!(await vscode.workspace.fs.stat(uri)); }
    catch (error) { if (!missing(error)) report(error); return false; }
  }
  const entryFor = (data) => {
    const packages = Array.isArray(data) ? data : [...(Array.isArray(data?.packages) ? data.packages : []),
      ...(Array.isArray(data?.['packages-dev']) ? data['packages-dev'] : [])];
    return TYPO3_PACKAGES.map((name) => packages.find((entry) => entry?.name === name)).find(Boolean);
  };
  function detectDirectory(uri) {
    const key = uri.toString();
    if (!cache.has(key)) cache.set(key, (async () => {
      const watches = [{ uri, pattern: DISCOVERY_PATTERN }];
      const [manifest, lock] = await Promise.all([readJson(join(uri, 'composer.json')), readJson(join(uri, 'composer.lock'))]);
      const vendorRoot = resolve(uri, manifest?.config?.['vendor-dir'], 'vendor');
      const configuredWeb = manifest?.extra?.['typo3/cms']?.['web-dir'];
      const webRoots = [...new Map([uri, ...[configuredWeb, 'public', 'web', 'htdocs'].filter(Boolean).map((dir) => resolve(uri, dir, 'public'))]
        .map((root) => [root.toString(), root])).values()];
      const candidates = webRoots.flatMap((webRoot) => [
        { coreRoot: join(webRoot, 'typo3/sysext/core'), webRoot, installation: 'classic' },
        { coreRoot: join(webRoot, 'typo3_src/typo3/sysext/core'), webRoot, installation: 'classic' }
      ]);
      const composerCore = { coreRoot: join(vendorRoot, 'typo3/cms-core'), webRoot: resolve(uri, configuredWeb, 'public'), installation: 'composer' };
      const declaredComposer = hasTypo3Package(manifest) && !TYPO3_PACKAGES.includes(manifest?.name) && manifest?.type !== 'typo3-cms-extension';
      if (declaredComposer) candidates.unshift(composerCore);
      else candidates.push(composerCore);
      let core;
      // Probe conventional paths only; do not search arbitrary source archives.
      const unreadable = new Set();
      const texts = await Promise.all(candidates.map((candidate, index) => readText(join(candidate.coreRoot, CORE_VERSION_FILE), () => unreadable.add(index))));
      for (let index = 0; index < candidates.length; index++) {
        const candidate = candidates[index], text = texts[index];
        if (text === null && !unreadable.has(index)) continue;
        const sourceUri = join(candidate.coreRoot, CORE_VERSION_FILE);
        core = { ...candidate, version: parseCoreVersion(text), sourceUri, source: 'core', ...(unreadable.has(index) ? { unreadable: true } : {}) };
        break; // An unreadable/unknown active core must not select an inactive copy.
      }
      const installedUri = join(vendorRoot, 'composer/installed.json');
      const installed = core?.installation === 'classic' ? null : entryFor(await readJson(installedUri));
      const locked = entryFor(lock);
      let boundary;
      if (!core && !installed && !locked && !hasTypo3Package(manifest)) {
        const markers = ['typo3conf/LocalConfiguration.php', 'typo3conf/system/settings.php', 'config/system/settings.php'];
        const found = await Promise.all(webRoots.map(async (root) => (await Promise.all(markers.map((marker) => exists(join(root, marker))))).some(Boolean)));
        boundary = webRoots[found.indexOf(true)];
      }
      if (!core && !installed && !locked && !hasTypo3Package(manifest) && !boundary) return { watches };
      const composerWebRoot = resolve(uri, configuredWeb, 'public');
      const oldComposerLayout = core?.installation === 'classic' && core.webRoot.toString() !== uri.toString()
        && core.webRoot.toString() === composerWebRoot.toString() && hasTypo3Package(manifest)
        && !TYPO3_PACKAGES.includes(manifest?.name) && manifest?.type !== 'typo3-cms-extension';
      const context = { root: uri, vendorRoot, webRoot: core?.webRoot || boundary || composerWebRoot,
        coreRoot: core?.coreRoot || (installed ? resolve(join(vendorRoot, 'composer'), installed['install-path'], '../typo3/cms-core') : undefined),
        installation: oldComposerLayout ? 'composer' : core?.installation || (boundary ? 'unknown' : 'composer'), isExtension: manifest?.type === 'typo3-cms-extension' };
      // Watch only existing bases: older editor versions log errors for missing
      // RelativePattern roots. Shallow discovery and core probes cover creation.
      if (core) watches.push({ uri: core.coreRoot, pattern: CORE_VERSION_FILE });
      if (await exists(vendorRoot)) watches.push({ uri: vendorRoot, pattern: `{composer/installed.json,typo3/cms-core/${CORE_VERSION_FILE}}` });
      const existingWebRoots = await Promise.all(webRoots.map((root) => exists(root)));
      webRoots.forEach((webRoot, index) => { if (existingWebRoots[index]) watches.push({ uri: webRoot, pattern: DISCOVERY_PATTERN }); });
      let info;
      if (core) info = { ...core, ...context, major: parseMajorVersion(core.version) };
      else if (installed && parseMajorVersion(installed.version) !== null) info = { ...context, major: parseMajorVersion(installed.version), version: installed.version, source: 'installed', sourceUri: installedUri };
      else if (locked && parseMajorVersion(locked.version) !== null) info = { ...context, major: parseMajorVersion(locked.version), version: locked.version, source: 'lock', sourceUri: join(uri, 'composer.lock') };
      else if (hasTypo3Package(manifest)) {
        const name = TYPO3_PACKAGES.find((item) => manifest?.require?.[item] !== undefined || manifest?.['require-dev']?.[item] !== undefined);
        info = { ...context, major: majorFromManifest(manifest), constraint: manifest.require?.[name] ?? manifest['require-dev']?.[name], source: 'manifest', sourceUri: join(uri, 'composer.json') };
      } else info = { ...context, major: null, version: locked?.version || installed?.version, source: locked ? 'unknown-lock' : 'fallback', sourceUri: locked ? join(uri, 'composer.lock') : undefined };
      if (['core', 'installed'].includes(info.source) && info.version && locked?.version && parseMajorVersion(locked.version) !== null
        && info.version.replace(/^v/, '') !== locked.version.replace(/^v/, '')) {
        info.conflict = { version: locked.version, sourceUri: join(uri, 'composer.lock') };
      }
      return { info, watches, candidates };
    })());
    return cache.get(key);
  }
  async function detectInfo(document, visit = watchDirectory) {
    if (!['file', 'vscode-remote'].includes(document.uri.scheme)) return { major: null, source: 'fallback' };
    let directory = document.uri.with({ path: path.dirname(document.uri.path), query: '', fragment: '' });
    if (directory.scheme === 'file' && /^\/[a-zA-Z]:$/.test(directory.path)) directory = directory.with({ path: `${directory.path}/` });
    let extension, classic;
    while (true) {
      const result = await detectDirectory(directory);
      for (const watch of result.watches) visit(watch.uri, watch.pattern);
      const info = result.info;
      if (classic) {
        // Old Composer layouts can expose the core through public/typo3/sysext.
        // Only merge an enclosing project's metadata when its configured webroot matches.
        if (info?.installation === 'composer' && info.webRoot.toString() === classic.root.toString()) {
          if (info.source === 'core' && info.coreRoot.toString() !== classic.coreRoot.toString()) return info;
          return { ...classic, ...info, ...Object.fromEntries(['major', 'version', 'source', 'sourceUri', 'coreRoot'].map((key) => [key, classic[key]])),
            conflict: info.version && info.version !== classic.version ? { version: info.version, sourceUri: info.sourceUri } : info.conflict };
        }
        return classic;
      }
      if (info?.installation === 'classic') classic = info;
      else if (info && !info.isExtension) return info;
      else if (info) extension ||= info;
      // A Windows drive or UNC share is a filesystem root, not a parent project.
      if (directory.scheme === 'file' && (/^\/[a-zA-Z]:\/$/.test(directory.path)
        || (directory.authority && directory.path.split('/').filter(Boolean).length <= 1))) break;
      let parent = path.dirname(directory.path);
      if (directory.scheme === 'file' && /^\/[a-zA-Z]:$/.test(parent)) parent += '/';
      if (parent === directory.path) break;
      directory = directory.with({ path: parent });
    }
    return classic || extension || { major: null, source: 'fallback' };
  }
  async function hasChanges(information) {
    const projects = new Map(information.map((info) => info.detected || info).filter((info) => info.root).map((info) => [info.root.toString(), info]));
    for (const [key, info] of projects) {
      if (info.source === 'core' && parseCoreVersion(await readText(info.sourceUri)) !== info.version) return true;
      if (info.source === 'fallback' && info.installation === 'unknown') {
        const cached = await cache.get(key);
        const versions = await Promise.all((cached?.candidates || []).map((candidate) => readText(join(candidate.coreRoot, CORE_VERSION_FILE))));
        if (versions.some((text) => parseCoreVersion(text) !== null)) return true;
      }
    }
    return false;
  }
  return { clear() { cache.clear(); }, retain(keys) { for (const key of cache.keys()) if (!keys.has(key)) cache.delete(key); }, hasChanges,
    detectInfo, async detect(document) { const major = (await detectInfo(document)).major; return major >= 11 ? major : null; } };
}

module.exports = { parseMajorVersion, parseConstraintMajor, majorFromLock, majorFromManifest, parseCoreVersion, createVersionDetector, DISCOVERY_PATTERN };
