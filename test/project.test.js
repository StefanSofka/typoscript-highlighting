const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path').posix;
const { createProject } = require('../lib/project');
const { createEditor, Uri } = require('./helpers/editor');
function setup(t) {
  const editor = createEditor();
  const root = Uri.file('/site');
  editor.vscode.FileType = { File: 1, Directory: 2 };
  editor.vscode.workspace.workspaceFolders = [{ uri: root }];
  editor.vscode.workspace.getWorkspaceFolder = () => ({ uri: root });
  editor.vscode.workspace.findFiles = async (pattern) => [...editor.files.keys()]
    .filter((key) => key.startsWith(pattern.baseUri.toString().replace(/\/$/, '') + '/'))
    .filter((key) => pattern.pattern.includes('composer.json') ? key.endsWith('/composer.json') : /(?:\/constants|\.constants)\.typoscript$/.test(key))
    .map((key) => Uri.file(key.slice('file://'.length)));
  editor.vscode.workspace.fs.stat = async (uri) => {
    if (editor.files.has(uri.toString())) return { type: 1 };
    if ([...editor.files.keys()].some((key) => key.startsWith(uri.toString().replace(/\/$/, '') + '/'))) return { type: 2 };
    throw Object.assign(new Error('Missing'), { code: 'FileNotFound' });
  };
  editor.vscode.workspace.fs.readDirectory = async (uri) => [...editor.files.keys()].map((key) => key.slice('file://'.length))
    .filter((key) => path.dirname(key) === uri.path).map((key) => [path.basename(key), 1]);
  const project = createProject(editor.vscode, { getInfo: () => ({ root }) }, assert.fail);
  t.after(() => project.dispose());
  const document = editor.document('/site/setup.typoscript', 'typoscript-v12');
  editor.put('/site/packages/site/composer.json', { type: 'typo3-cms-extension', name: 'vendor/site', extra: { 'typo3/cms': { 'extension-key': 'my_site' } } });
  return { editor, project, document };
}

test('EXT and relative imports resolve deterministically and reject directory traversal', async (t) => {
  const { editor, project, document } = setup(t);
  editor.put('/site/constants.typoscript', 'site.name = Example');
  editor.put('/site/packages/site/Setup/20-last.typoscript', 'page = PAGE');
  editor.put('/site/packages/site/Setup/10-first.typoscript', 'page = PAGE');
  assert.equal((await project.resolveImport(document, { path: './constants.typoscript' })).uris[0].path, '/site/constants.typoscript');
  assert.deepEqual((await project.resolveImport(document, { path: 'EXT:my_site/Setup/*.typoscript' })).uris.map((uri) => path.basename(uri.path)), ['10-first.typoscript', '20-last.typoscript']);
  assert.equal((await project.resolveImport(document, { path: 'EXT:my_site/../private.typoscript' })).uris.length, 0);
  assert.equal((await project.resolveImport(document, { path: 'EXT:missing/setup.typoscript' })).uris.length, 0);
  assert.equal((await project.resolveImport(document, { path: './*.typoscript' }, { isCancellationRequested: true })).uris.length, 0);
});

test('source discovery handles import cycles, unsaved documents and sibling constants', async (t) => {
  const { editor, project, document } = setup(t);
  document.text = '@import "./a.typoscript"\npage.value = {$site.name}';
  editor.put('/site/a.typoscript', '@import "./setup.typoscript"\nlib.a = TEXT');
  editor.put('/site/constants.typoscript', 'site.name = Example');
  const sources = await project.sources(document);
  assert.equal(sources.length, 3);
  assert.equal(new Set(sources.map((source) => source.uri.toString())).size, 3);
  assert.equal(sources[0].parsed.references[0].name, 'site.name');
  document.text = 'page.value = Changed'; document.version++;
  editor.events.text.fire({ document });
  assert.equal(project.analyze(document).references.length, 0);
});

test('extension discovery prefers editable packages and does not borrow other workspace projects', async (t) => {
  const { editor, project, document } = setup(t);
  editor.vscode.workspace.workspaceFolders.push({ uri: Uri.file('/other') });
  editor.put('/other/composer.json', { type: 'typo3-cms-extension', name: 'example/outside', extra: { 'typo3/cms': { 'extension-key': 'outside' } } });
  editor.put('/other/secret.typoscript', 'page = PAGE');
  editor.put('/site/vendor/vendor/site/composer.json', { type: 'typo3-cms-extension', name: 'vendor/site', extra: { 'typo3/cms': { 'extension-key': 'my_site' } } });
  editor.put('/site/vendor/vendor/site/setup.typoscript', 'lib.source = VENDOR');
  editor.put('/site/packages/site/setup.typoscript', 'lib.source = WORKSPACE');
  const resolved = await project.resolveImport(document, { path: 'EXT:my_site/setup.typoscript' });
  assert.equal(resolved.uris[0].path, '/site/packages/site/setup.typoscript');
  assert.equal((await project.resolveImport(document, { path: 'EXT:outside/secret.typoscript' })).uris.length, 0);
});

test('untitled documents retain local structure without reading unrelated project files', async (t) => {
  const { editor, project, document } = setup(t);
  document.uri = new Uri('untitled', 'Untitled-1');
  document.text = 'site.name = Draft\npage.value = {$site.name}';
  assert.equal((await project.sources(document)).length, 1);
  assert.equal((await project.allSources(document)).length, 1);
  assert.equal((await project.resolveImport(document, { path: './constants.typoscript' })).uris.length, 0);
  assert.equal(editor.reads.length, 0);
});
