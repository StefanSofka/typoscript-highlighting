const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createController } = require('../lib/controller');
const { createEditor } = require('./helpers/editor');

function setup(t) {
  const editor = createEditor();
  const errors = [];
  const controller = createController(editor.vscode, (error) => errors.push(error));
  t.after(() => controller.dispose());
  return { editor, controller, errors };
}

test('different projects use their own versions in the same workspace', async (t) => {
  const { editor, controller } = setup(t);
  editor.put('/old/composer.json', { require: { 'typo3/cms-core': '^11' } });
  editor.put('/new/composer.lock', { packages: [{ name: 'typo3/cms-core', version: '13.4.0' }] });
  editor.document('/old/setup.typoscript');
  editor.document('/new/setup.tsconfig');
  await controller.refresh();
  assert.deepEqual(editor.documents.map((doc) => doc.languageId), ['typoscript-v11', 'typoscript-v12']);
});

test('resource settings are honored and forced modes avoid filesystem reads', async (t) => {
  const { editor, controller } = setup(t);
  const old = editor.document('/old/setup.typoscript');
  const current = editor.document('/new/setup.typoscript');
  editor.settings.set(old.uri.toString(), 'v11');
  editor.settings.set(current.uri.toString(), 'v12');
  await controller.refresh();
  assert.deepEqual(editor.documents.map((doc) => doc.languageId), ['typoscript-v11', 'typoscript-v12']);
  assert.equal(editor.reads.length, 0);
});

test('unknown versions default to v12 without touching unrelated documents', async (t) => {
  const { editor, controller } = setup(t);
  editor.document('/site/setup.typoscript');
  editor.document('/site/other.typoscript', 'plaintext');
  editor.document('/site/main.js', 'javascript');
  await controller.refresh();
  assert.deepEqual(editor.documents.map((doc) => doc.languageId), ['typoscript-v12', 'plaintext', 'javascript']);
  assert.equal(editor.changes.length, 1);
});

for (const kind of ['create', 'change', 'delete']) test(`Composer ${kind} events invalidate cached versions`, async (t) => {
  const { editor, controller } = setup(t);
  if (kind !== 'create') editor.put('/site/composer.json', { require: { 'typo3/cms-core': '^11' } });
  editor.document('/site/setup.typoscript');
  await controller.refresh();
  if (kind === 'delete') editor.files.delete('file:///site/composer.json');
  else editor.put('/site/composer.json', { require: { 'typo3/cms-core': kind === 'create' ? '^11' : '^12' } });
  editor.notifyFile('/site/composer.json', kind);
  await controller.whenIdle();
  assert.equal(editor.documents[0].languageId, kind === 'create' ? 'typoscript-v11' : 'typoscript-v12');
});

test('a new lockfile overrides a cached manifest, including parent projects', async (t) => {
  const { editor, controller } = setup(t);
  editor.put('/project/composer.json', { require: { 'typo3/cms-core': '^11' } });
  editor.document('/project/packages/site/setup.typoscript');
  await controller.refresh();
  editor.put('/project/composer.lock', { packages: [{ name: 'typo3/cms-core', version: '12.4.0' }] });
  editor.notifyFile('/project/composer.lock', 'create');
  await controller.whenIdle();
  assert.equal(editor.documents[0].languageId, 'typoscript-v12');
});

test('configuration changes update open documents without pinning automatic switches', async (t) => {
  const { editor, controller } = setup(t);
  editor.mode = 'v11';
  editor.document('/site/setup.typoscript');
  await controller.refresh();
  editor.mode = 'v12';
  editor.events.configuration.fire({ affectsConfiguration: () => true });
  await controller.whenIdle();
  assert.equal(editor.documents[0].languageId, 'typoscript-v12');
  editor.mode = 'v11';
  editor.events.configuration.fire({ affectsConfiguration: () => true });
  await controller.whenIdle();
  assert.equal(editor.documents[0].languageId, 'typoscript-v11');
});

test('initial manual language modes are preserved in auto mode', async (t) => {
  const { editor, controller } = setup(t);
  editor.document('/site/setup.typoscript', 'typoscript-v11');
  await controller.refresh();
  assert.equal(editor.documents[0].languageId, 'typoscript-v11');
  assert.equal(editor.reads.length, 0);
});

test('manual language changes override auto detection until generic TypoScript is selected', async (t) => {
  const { editor, controller } = setup(t);
  editor.put('/site/composer.json', { require: { 'typo3/cms-core': '^12' } });
  editor.document('/site/setup.typoscript');
  await controller.refresh();
  await editor.setLanguage(editor.documents[0], 'typoscript-v11');
  await controller.whenIdle();
  await controller.refresh();
  assert.equal(editor.documents[0].languageId, 'typoscript-v11');
  await editor.setLanguage(editor.documents[0], 'typoscript');
  await controller.whenIdle();
  assert.equal(editor.documents[0].languageId, 'typoscript-v12');
});

test('forced settings temporarily override a manual pin', async (t) => {
  const { editor, controller } = setup(t);
  editor.document('/site/setup.typoscript', 'typoscript-v11');
  await controller.refresh();
  editor.mode = 'v12';
  await controller.refresh();
  assert.equal(editor.documents[0].languageId, 'typoscript-v12');
  editor.mode = 'auto';
  await controller.refresh();
  assert.equal(editor.documents[0].languageId, 'typoscript-v11');
});

test('language-switch rejections are reported without an unhandled rejection', async (t) => {
  const { editor, controller, errors } = setup(t);
  editor.mode = 'v11';
  editor.document('/site/setup.typoscript');
  editor.languageHook = async () => { throw new Error('Document is unavailable'); };
  await controller.refresh();
  assert.equal(errors.length, 1);
  assert.equal(editor.documents[0].languageId, 'typoscript');
});

test('a setting changed during detection wins over the stale result', async (t) => {
  const { editor, controller } = setup(t);
  editor.document('/site/setup.typoscript');
  let release;
  let entered;
  const enteredPromise = new Promise((resolve) => { entered = resolve; });
  const blocked = new Promise((resolve) => { release = resolve; });
  editor.readHook = async () => { entered(); await blocked; };
  const first = controller.refresh();
  await enteredPromise;
  editor.mode = 'v11';
  const latest = controller.refresh();
  release();
  await Promise.all([first, latest]);
  assert.deepEqual(editor.changes.map((change) => change.languageId), ['typoscript-v11']);
});

test('closed documents are not changed after an asynchronous lookup', async (t) => {
  const { editor, controller } = setup(t);
  const document = editor.document('/site/setup.typoscript');
  editor.readHook = async () => { document.isClosed = true; };
  await controller.refresh();
  assert.equal(editor.changes.length, 0);
});

test('workspace changes refresh detection and disposal releases listeners and watchers', async (t) => {
  const { editor, controller } = setup(t);
  editor.put('/site/composer.json', { require: { 'typo3/cms-core': '^11' } });
  editor.document('/site/setup.typoscript');
  await controller.refresh();
  editor.put('/site/composer.json', { require: { 'typo3/cms-core': '^12' } });
  editor.events.folders.fire({});
  await controller.whenIdle();
  assert.equal(editor.documents[0].languageId, 'typoscript-v12');
  controller.dispose();
  assert.ok(editor.watchers.every((watcher) => watcher.disposed));
  assert.ok(Object.values(editor.events).every((signal) => signal.size === 0));
  editor.mode = 'v11';
  await controller.refresh();
  assert.equal(editor.documents[0].languageId, 'typoscript-v12');
});
