const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { parseCoreVersion, createVersionDetector } = require('../lib/version');
const { createController } = require('../lib/controller');
const { createEditor } = require('./helpers/editor');
const coreFile = 'Classes/Information/Typo3Version.php';
const php = (version) => `<?php\nnamespace TYPO3\\CMS\\Core\\Information;\nclass Typo3Version { protected const VERSION = '${version}'; }`;

test('core reader accepts literal class constants and ignores comments, other namespaces and executable expressions', () => {
  assert.equal(parseCoreVersion(php('11.5.42')), '11.5.42');
  assert.equal(parseCoreVersion(php('14.3.0-RC1')), '14.3.0-RC1');
  assert.equal(parseCoreVersion(php('13.4.0').replace('namespace TYPO3', `/* ${php('11.5.0')} */\nnamespace TYPO3`)), '13.4.0');
  for (const text of [php('13.4.0').replace('Information', 'Other'), php('13.4.0').replace("'13.4.0'", "getenv('VERSION')"),
    `<?php /* ${php('11.5.0')} */`, `<?php $example = "${php('11.5.0')}";`, php('dev-main'), php('13.4.0').replace('Typo3Version', 'SomethingElse')]) assert.equal(parseCoreVersion(text), null);
});

test('Composer uses the installed core, configured directories and reports a stale lockfile', async () => {
  const editor = createEditor();
  editor.put('/site/composer.json', { require: { 'typo3/cms-core': '^14' }, config: { 'vendor-dir': 'dependencies' }, extra: { 'typo3/cms': { 'web-dir': 'www' } } });
  editor.put('/site/composer.lock', { packages: [{ name: 'typo3/cms-core', version: '14.3.0' }] });
  editor.put(`/site/dependencies/typo3/cms-core/${coreFile}`, php('13.4.0'));
  const info = await createVersionDetector(editor.vscode).detectInfo(editor.document('/site/packages/site/setup.typoscript'));
  assert.equal(info.source, 'core'); assert.equal(info.version, '13.4.0'); assert.equal(info.installation, 'composer');
  assert.equal(info.webRoot.path, '/site/www'); assert.equal(info.vendorRoot.path, '/site/dependencies');
  assert.equal(info.conflict.version, '14.3.0');
});

for (const layout of ['', 'public/', 'web/', 'htdocs/']) test(`copied Classic core in ${layout || 'the project root'} beats bundled Composer metadata and inactive archives`, async () => {
  const editor = createEditor();
  editor.put(`/site/${layout}typo3/sysext/core/${coreFile}`, php('11.5.42'));
  editor.put('/site/composer.json', { name: 'typo3/cms', require: { 'some/dependency': '^1' } });
  editor.put(`/site/${layout}typo3_src-14.3.0/typo3/sysext/core/${coreFile}`, php('14.3.0'));
  const info = await createVersionDetector(editor.vscode).detectInfo(editor.document(`/site/${layout}typo3conf/ext/site/setup.typoscript`));
  assert.equal(info.version, '11.5.42'); assert.equal(info.installation, 'classic'); assert.equal(info.webRoot.path, `/site/${layout}`.replace(/\/$/, ''));
});

for (const installed of [
  [{ name: 'typo3/cms-core', version: '12.4.9' }],
  { packages: [{ name: 'typo3/cms-core', version: '12.4.9', 'install-path': '../typo3/cms-core' }] }
]) test(`Composer installed metadata works without PHP or lockfile (${Array.isArray(installed) ? 'v1' : 'v2'} format)`, async () => {
  const editor = createEditor(); editor.put('/site/vendor/composer/installed.json', installed);
  const info = await createVersionDetector(editor.vscode).detectInfo(editor.document('/site/setup.typoscript'));
  assert.equal(info.major, 12); assert.equal(info.source, 'installed'); assert.equal(info.installation, 'composer');
});

test('a Sitepackage compatibility range does not hide the enclosing installed site', async () => {
  const editor = createEditor();
  editor.put('/site/packages/site/composer.json', { type: 'typo3-cms-extension', require: { 'typo3/cms-core': '^11 || ^12 || ^13 || ^14' } });
  editor.put(`/site/vendor/typo3/cms-core/${coreFile}`, php('14.3.0'));
  const detector = createVersionDetector(editor.vscode), document = editor.document('/site/packages/site/setup.typoscript');
  assert.equal((await detector.detectInfo(document)).version, '14.3.0');
  editor.files.delete(`file:///site/vendor/typo3/cms-core/${coreFile}`); detector.clear();
  const standalone = await detector.detectInfo(document);
  assert.equal(standalone.source, 'manifest'); assert.equal(standalone.major, null); assert.equal(standalone.root.path, '/site/packages/site');
});

test('an incomplete nested Classic installation does not borrow its parent version', async () => {
  const editor = createEditor();
  editor.put('/sites/composer.lock', { packages: [{ name: 'typo3/cms-core', version: '11.5.42' }] });
  editor.put('/sites/shop/typo3conf/LocalConfiguration.php', '<?php return [];');
  const info = await createVersionDetector(editor.vscode).detectInfo(editor.document('/sites/shop/typo3conf/ext/site/setup.typoscript'));
  assert.equal(info.major, null); assert.equal(info.root.path, '/sites/shop');
});

test('old Composer webroot layouts retain project metadata while using their active core', async () => {
  const editor = createEditor();
  editor.put('/site/composer.json', { require: { 'typo3/cms-core': '^11' } });
  editor.put('/site/composer.lock', { packages: [{ name: 'typo3/cms-core', version: '11.5.0' }] });
  editor.put(`/site/public/typo3/sysext/core/${coreFile}`, php('11.5.42'));
  const info = await createVersionDetector(editor.vscode).detectInfo(editor.document('/site/public/typo3conf/ext/site/setup.typoscript'));
  assert.equal(info.root.path, '/site'); assert.equal(info.installation, 'composer'); assert.equal(info.version, '11.5.42');
  assert.equal(info.conflict.version, '11.5.0');
});

test('Composer vendor core wins over a leftover sysext copy after a migration', async () => {
  const editor = createEditor();
  editor.put('/site/composer.json', { require: { 'typo3/cms-core': '^14' } });
  editor.put(`/site/vendor/typo3/cms-core/${coreFile}`, php('14.3.0'));
  editor.put(`/site/public/typo3/sysext/core/${coreFile}`, php('11.5.42'));
  const info = await createVersionDetector(editor.vscode).detectInfo(editor.document('/site/public/typo3conf/ext/site/setup.typoscript'));
  assert.equal(info.version, '14.3.0'); assert.equal(info.installation, 'composer'); assert.equal(info.root.path, '/site');
});

test('an unreadable active core does not silently select an inactive source copy', async () => {
  const editor = createEditor(), errors = [];
  const active = `/site/typo3/sysext/core/${coreFile}`;
  editor.put(active, php('11.5.42')); editor.put(`/site/typo3_src/typo3/sysext/core/${coreFile}`, php('14.3.0'));
  editor.readHook = async (uri) => { if (uri.path === active) throw Object.assign(new Error('Permission denied'), { code: 'NoPermissions' }); };
  const info = await createVersionDetector(editor.vscode, undefined, (error) => errors.push(error)).detectInfo(editor.document('/site/setup.typoscript'));
  assert.equal(info.major, null); assert.equal(info.unreadable, true); assert.equal(info.sourceUri.path, active); assert.ok(errors.length > 0);
});

test('remote Classic paths retain authority, and core changes invalidate automatic selection', async (t) => {
  const editor = createEditor(), controller = createController(editor.vscode, assert.fail);
  t.after(() => controller.dispose());
  editor.put(`/site/typo3/sysext/core/${coreFile}`, php('11.5.42'), 'vscode-remote', 'ssh-remote+host');
  editor.document('/site/setup.typoscript', 'typoscript', 'vscode-remote', 'ssh-remote+host'); await controller.refresh();
  assert.equal(editor.documents[0].languageId, 'typoscript-v11');
  const info = controller.getInfo(editor.documents[0]); assert.equal(info.sourceUri.authority, 'ssh-remote+host');
  editor.put(`/site/typo3/sysext/core/${coreFile}`, php('14.3.0'), 'vscode-remote', 'ssh-remote+host');
  const watcher = editor.watchers.find((entry) => entry.pattern.baseUri.path === '/site/typo3/sysext/core');
  watcher.events.change.fire(info.sourceUri); await controller.whenIdle();
  assert.equal(editor.documents[0].languageId, 'typoscript-v12'); assert.equal(controller.getInfo(editor.documents[0]).major, 14);
});

test('the core probe recovers omitted events, a missing core and reinstall, then stops reading closed projects', async (t) => {
  const editor = createEditor(), controller = createController(editor.vscode, assert.fail);
  t.after(() => controller.dispose());
  const filename = `/site/typo3/sysext/core/${coreFile}`;
  editor.put(filename, php('11.5.42')); editor.put('/site/typo3conf/LocalConfiguration.php', '<?php return [];');
  editor.document('/site/setup.typoscript'); await controller.refresh();
  editor.put(filename, php('14.3.0')); await controller.checkForChanges();
  assert.equal(controller.getInfo(editor.documents[0]).version, '14.3.0');
  editor.files.delete(`file://${filename}`); await controller.checkForChanges();
  assert.equal(controller.getInfo(editor.documents[0]).source, 'fallback');
  editor.put(filename, php('12.4.0')); await controller.checkForChanges();
  assert.equal(controller.getInfo(editor.documents[0]).version, '12.4.0');
  const document = editor.documents.shift(); document.isClosed = true; editor.events.close.fire(document);
  const before = editor.reads.length; await controller.checkForChanges();
  assert.equal(editor.reads.length, before); assert.ok(editor.watchers.every((watcher) => watcher.disposed));
});

test('real Classic symlinks follow the active target, including target replacement', async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'typoscript-core-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const editor = createEditor();
  editor.vscode.workspace.fs = {
    readFile: (uri) => fs.readFile(uri.path), stat: (uri) => fs.stat(uri.path)
  };
  for (const version of ['11.5.42', '14.3.0']) {
    const target = path.join(temporary, `typo3_src-${version}`, 'typo3/sysext/core');
    await fs.mkdir(path.join(target, 'Classes/Information'), { recursive: true }); await fs.writeFile(path.join(target, coreFile), php(version));
  }
  const site = path.join(temporary, 'site'); await fs.mkdir(site);
  await fs.symlink('../typo3_src-11.5.42', path.join(site, 'typo3_src'));
  await fs.symlink('typo3_src/typo3', path.join(site, 'typo3'));
  const detector = createVersionDetector(editor.vscode, undefined, assert.fail), document = editor.document(path.join(site, 'setup.typoscript'));
  assert.equal((await detector.detectInfo(document)).version, '11.5.42');
  await fs.unlink(path.join(site, 'typo3_src')); await fs.symlink('../typo3_src-14.3.0', path.join(site, 'typo3_src')); detector.clear();
  assert.equal((await detector.detectInfo(document)).version, '14.3.0');
});
