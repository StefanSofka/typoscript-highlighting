const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path').posix;
const { Uri } = require('./helpers/editor');
const { setupProject } = require('./helpers/project');
function setup(t) {
  const fixture = setupProject(t);
  fixture.editor.put('/site/packages/site/composer.json', { type: 'typo3-cms-extension', name: 'vendor/site', extra: { 'typo3/cms': { 'extension-key': 'my_site' } } });
  return fixture;
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

test('Classic EXT imports use local and system directory names without Composer metadata', async (t) => {
  const { editor, project, document } = setup(t);
  editor.projectInfo = { webRoot: Uri.file('/site/www'), coreRoot: Uri.file('/site/www/typo3/sysext/core') };
  editor.put('/site/www/typo3conf/ext/classic/Configuration/setup.typoscript', 'page = PAGE');
  editor.put('/site/www/typo3/sysext/core/Configuration/setup.typoscript', 'lib.core = TEXT');
  assert.equal((await project.resolveImport(document, { path: 'EXT:classic/Configuration/setup.typoscript' })).uris[0].path, '/site/www/typo3conf/ext/classic/Configuration/setup.typoscript');
  assert.equal((await project.resolveImport(document, { path: 'EXT:core/Configuration/setup.typoscript' })).uris[0].path, '/site/www/typo3/sysext/core/Configuration/setup.typoscript');
});

test('site settings use the detected roots, include set defaults and refresh unsaved YAML', async (t) => {
  const { editor, project, document } = setup(t);
  editor.projectInfo = { webRoot: Uri.file('/site/www'), vendorRoot: Uri.file('/site/dependencies') };
  editor.put('/site/www/typo3conf/sites/main/config.yaml', 'dependencies: [vendor/main]');
  editor.put('/site/packages/site/Configuration/Sets/Main/config.yaml', 'name: vendor/main\ndependencies: [vendor/library]');
  editor.put('/site/dependencies/vendor/library/Configuration/Sets/Library/config.yaml', 'name: vendor/library');
  editor.put('/site/www/typo3conf/sites/main/settings.yaml', 'site.title: Website from YAML');
  editor.put('/site/packages/site/Configuration/Sets/Main/settings.definitions.yaml', 'settings:\n  site.title:\n    type: string\n    default: Default title\n    label: Website title');
  editor.put('/site/dependencies/vendor/library/composer.json', { type: 'typo3-cms-extension', name: 'vendor/library' });
  editor.put('/site/dependencies/vendor/library/Configuration/Sets/Library/settings.yaml', 'library.name: Library');
  let definitions = await project.constantDefinitions(document);
  assert.equal(definitions.filter((node) => node.path === 'site.title').length, 2);
  assert.ok(definitions.some((node) => node.path === 'library.name'));
  const yaml = editor.document('/site/www/typo3conf/sites/main/settings.yaml', 'yaml'); yaml.text = 'site.title: Unsaved YAML';
  editor.events.text.fire({ document: yaml });
  definitions = await project.constantDefinitions(document);
  assert.ok(definitions.some((node) => node.path === 'site.title' && node.value.trim() === 'Unsaved YAML'));
  editor.documents.splice(editor.documents.indexOf(yaml), 1); editor.events.close.fire(yaml);
  assert.ok((await project.constantDefinitions(document)).some((node) => node.path === 'site.title' && node.value.trim() === 'Website from YAML'));
  assert.deepEqual(await project.siteSettings(document, { isCancellationRequested: true }), []);
});

test('concurrent YAML requests share reads without one cancellation hiding another request\'s results', async (t) => {
  const { editor, project, document } = setup(t);
  const filename = '/site/config/sites/main/settings.yaml'; editor.put(filename, 'site.title: Website');
  let release, entered;
  const blocked = new Promise((resolve) => { release = resolve; }), reading = new Promise((resolve) => { entered = resolve; });
  editor.readHook = async (uri) => { if (uri.path === filename) { entered(); await blocked; } };
  const token = { isCancellationRequested: false };
  const first = project.siteSettings(document, token), second = project.siteSettings(document);
  await reading; token.isCancellationRequested = true; release();
  assert.deepEqual(await first, []); assert.equal((await second)[0].path, 'site.title');
  assert.equal(editor.reads.filter((uri) => uri === `file://${filename}`).length, 1);
});
