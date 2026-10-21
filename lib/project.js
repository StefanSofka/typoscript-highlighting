const path = require('node:path').posix;
const { parse } = require('./parser');
const { isTypoScript } = require('./language');

const EXCLUDE = '**/{node_modules,.git,.vscode-test,var,typo3temp}/**';
const directoryOf = (uri) => uri.with({ path: path.dirname(uri.path), query: '', fragment: '' });
const isCancelled = (token) => !!token?.isCancellationRequested;

function createProject(vscode, controller, report = () => {}) {
  const parsed = new Map();
  const extensions = new Map();
  const sourceCache = new Map();
  const changeListeners = new Set();
  let revision = 0;
  const keyOf = (uri) => uri.toString();
  function analyze(document) {
    const key = keyOf(document.uri);
    let entry = parsed.get(key);
    if (!entry || entry.version !== document.version || entry.language !== document.languageId) {
      entry = { version: document.version, language: document.languageId, value: parse(document.getText(), document.languageId) };
      parsed.set(key, entry);
    }
    return entry.value;
  }
  async function read(uri, language, token) {
    if (isCancelled(token)) return null;
    const open = vscode.workspace.textDocuments.find((document) => keyOf(document.uri) === keyOf(uri));
    if (open) return { uri, parsed: analyze(open) };
    try {
      const text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
      return { uri, parsed: parse(text, language) };
    } catch (error) {
      if (!['FileNotFound', 'ENOENT', 'FileIsADirectory', 'EISDIR'].includes(error.code)) report(error);
      return null;
    }
  }
  function rootFor(document) {
    return controller.getInfo(document)?.root || vscode.workspace.getWorkspaceFolder(document.uri)?.uri || directoryOf(document.uri);
  }
  async function readJson(uri) {
    try { return JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8')); }
    catch { return null; }
  }
  function extensionRoots(root) {
    const key = keyOf(root);
    if (!extensions.has(key)) extensions.set(key, (async () => {
      const result = new Map();
      const manifests = await vscode.workspace.findFiles(new vscode.RelativePattern(root,
        '{composer.json,packages/**/composer.json,public/typo3conf/ext/*/composer.json,typo3conf/ext/*/composer.json,vendor/*/*/composer.json}'), EXCLUDE, 1000);
      // Workspace sitepackages also work when the Composer project is above the workspace.
      const workspaceManifests = new Set();
      for (const folder of vscode.workspace.workspaceFolders || []) {
        const prefix = root.path.replace(/\/$/, '');
        if (folder.uri.scheme !== root.scheme || folder.uri.authority !== root.authority
          || !(folder.uri.path === prefix || folder.uri.path.startsWith(`${prefix}/`))) continue;
        const uri = vscode.Uri.joinPath(folder.uri, 'composer.json');
        manifests.push(uri); workspaceManifests.add(keyOf(uri));
      }
      const seen = new Set();
      const ranks = new Map();
      const unique = manifests.filter((uri) => { if (seen.has(keyOf(uri))) return false; seen.add(keyOf(uri)); return true; });
      // Bound concurrent remote reads without serializing a large Composer tree.
      for (let index = 0; index < unique.length; index += 16) {
        const batch = await Promise.all(unique.slice(index, index + 16).map(async (uri) => ({ uri, data: await readJson(uri) })));
        for (const { uri, data } of batch) {
          if (!data) continue;
          const rank = workspaceManifests.has(keyOf(uri)) ? 3 : uri.path.includes('/vendor/') ? 0 : uri.path.includes('/packages/') ? 2 : 1;
          const accept = (key) => { if (!result.has(key) || rank > ranks.get(key)) { result.set(key, directoryOf(uri)); ranks.set(key, rank); } };
          const extensionKey = data.extra?.['typo3/cms']?.['extension-key'];
          if (typeof extensionKey === 'string' && /^[a-zA-Z0-9_]+$/.test(extensionKey)) accept(extensionKey);
          else if (data.type === 'typo3-cms-extension' && typeof data.name === 'string') {
            const fallback = data.name.split('/').at(-1).replace(/-/g, '_');
            accept(fallback);
          }
        }
      }
      return result;
    })().catch((error) => { extensions.delete(key); report(error); return new Map(); }));
    return extensions.get(key);
  }
  async function resolveImport(document, item, token) {
    const fail = (reason) => ({ uris: [], reason });
    if (isCancelled(token)) return fail('Cancelled');
    if (!['file', 'vscode-remote'].includes(document.uri.scheme)) return fail('Save this document in a project to resolve imports');
    const value = item.path;
    if (!value || value.includes('\0') || value.split('/').includes('..')) return fail('Parent traversal is not supported');
    let base, relative;
    if (value.startsWith('EXT:')) {
      const match = value.match(/^EXT:([a-zA-Z0-9_]+)\/(.*)$/);
      if (!match) return fail('Invalid EXT: path');
      base = (await extensionRoots(rootFor(document))).get(match[1]);
      if (!base) return fail(`Extension ${match[1]} was not found in this project`);
      relative = match[2];
    } else if (value.startsWith('./')) { base = directoryOf(document.uri); relative = value.slice(2); }
    else return fail('Use ./ or EXT: for project imports');
    if (isCancelled(token)) return fail('Cancelled');
    const filename = path.basename(relative);
    const dirname = relative.endsWith('/') || !relative ? relative : path.dirname(relative);
    if (dirname.includes('*') || (filename.match(/\*/g) || []).length > 1) return fail('Wildcards are allowed once, in the filename');
    const uri = vscode.Uri.joinPath(base, relative);
    try {
      const stat = !relative.includes('*') ? await vscode.workspace.fs.stat(uri) : null;
      if (stat?.type & vscode.FileType.File) return { uris: [uri] };
      const directory = stat?.type & vscode.FileType.Directory ? uri : vscode.Uri.joinPath(base, dirname);
      if (stat && !(stat.type & vscode.FileType.Directory)) return fail('Import target is not a file or directory');
      const mask = stat ? '*' : filename;
      const regex = new RegExp(`^${mask.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
      const tsconfig = document.uri.path.endsWith('.tsconfig');
      const entries = await vscode.workspace.fs.readDirectory(directory);
      const names = entries.filter(([name, type]) => (type & vscode.FileType.File) && regex.test(name)
        && (name.endsWith('.typoscript') || (tsconfig && name.endsWith('.tsconfig')))).map(([name]) => name).sort();
      return names.length ? { uris: names.map((name) => vscode.Uri.joinPath(directory, name)) } : fail('No matching TypoScript files');
    } catch (error) {
      if (!['FileNotFound', 'ENOENT', 'FileNotADirectory', 'ENOTDIR'].includes(error.code)) report(error);
      return fail('Import target was not found');
    }
  }
  async function collectSources(document, token) {
    if (!['file', 'vscode-remote'].includes(document.uri.scheme)) return [{ uri: document.uri, parsed: analyze(document) }];
    const result = [];
    const seen = new Set();
    const queue = [document.uri];
    const root = rootFor(document);
    const constants = await vscode.workspace.findFiles(new vscode.RelativePattern(root, '**/{constants.typoscript,*.constants.typoscript,constants.txt}'), EXCLUDE, 200, token);
    queue.push(...constants);
    while (queue.length && result.length < 300 && !isCancelled(token)) {
      const uri = queue.shift();
      if (seen.has(keyOf(uri))) continue;
      seen.add(keyOf(uri));
      const source = keyOf(uri) === keyOf(document.uri) ? { uri, parsed: analyze(document) } : await read(uri, document.languageId, token);
      if (!source) continue;
      result.push(source);
      const sourceDocument = { uri, languageId: document.languageId };
      for (const item of source.parsed.imports) queue.push(...(await resolveImport(sourceDocument, item, token)).uris);
    }
    return result;
  }
  function sources(document, token) {
    const generation = revision;
    const key = `${keyOf(document.uri)}:${document.version}:${document.languageId}:${revision}`;
    if (sourceCache.has(key)) return sourceCache.get(key);
    const collected = collectSources(document, token).then((result) => {
      if (!isCancelled(token) && generation === revision) sourceCache.set(key, Promise.resolve(result));
      return result;
    });
    if (!token) sourceCache.set(key, collected);
    return collected;
  }
  async function allSources(document, token) {
    const initial = [...await sources(document, token)];
    if (!['file', 'vscode-remote'].includes(document.uri.scheme)) return initial;
    const seen = new Set(initial.map((entry) => keyOf(entry.uri)));
    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(rootFor(document), '**/*.{typoscript,tsconfig}'),
      '**/{node_modules,.git,.vscode-test,var,typo3temp,vendor}/**', 1000, token);
    for (const uri of files) {
      if (isCancelled(token)) break;
      if (seen.has(keyOf(uri))) continue;
      const source = await read(uri, document.languageId, token);
      if (source) { initial.push(source); seen.add(keyOf(uri)); }
    }
    return initial;
  }
  const clear = (notify = true) => { revision++; parsed.clear(); extensions.clear(); sourceCache.clear(); if (notify) for (const listener of changeListeners) listener(); };
  const watcher = vscode.workspace.createFileSystemWatcher('**/{composer.json,composer.lock,*.typoscript,*.tsconfig}');
  const subscriptions = [
    watcher, watcher.onDidCreate(clear), watcher.onDidChange(clear), watcher.onDidDelete(clear),
    vscode.workspace.onDidChangeWorkspaceFolders(clear),
    vscode.workspace.onDidChangeTextDocument(({ document }) => { if (isTypoScript(document)) { revision++; parsed.delete(keyOf(document.uri)); sourceCache.clear(); } }),
    vscode.workspace.onDidCloseTextDocument((document) => { parsed.delete(keyOf(document.uri)); revision++; sourceCache.clear(); })
  ];
  return { analyze, read, rootFor, resolveImport, sources, allSources, extensionRoots, get revision() { return revision; }, clear,
    onDidChange(listener) { changeListeners.add(listener); return { dispose() { changeListeners.delete(listener); } }; },
    dispose() { subscriptions.forEach((item) => item.dispose()); changeListeners.clear(); clear(); } };
}

module.exports = { createProject, directoryOf };
