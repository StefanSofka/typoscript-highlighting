const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseMajorVersion, parseConstraintMajor, majorFromLock, majorFromManifest, createVersionDetector } = require('../lib/version');
const { createEditor } = require('./helpers/editor');

for (const [input, expected] of [
  ['11.5.42', 11], ['v11.5.42', 11], ['12.4.0', 12], ['13.4.1', 13], ['14.0.0-RC1', 14],
  [' 11.5.0 ', 11], ['11.5.x-dev', 11], [null, null], ['', null], ['dev-main', null], ['dev-feature-11', null], ['^11.5', null], ['99999999999999999999.0.0', null]
]) test(`locked version ${JSON.stringify(input)}`, () => assert.equal(parseMajorVersion(input), expected));

for (const [input, expected] of [
  ['^11.5', 11], ['~11.5.0', 11], ['~11.5', 11], ['11.*', 11], ['11.5.x', 11], ['11', 11],
  ['v11.5.42', 11], ['^11.5@dev', 11], ['>=11.5 <12.0', 11], ['>= 11.5, < 12', 11],
  ['>11 <=11.9', 11], ['11.5 - 11.9', 11], ['^11.0 || ~11.5.0', 11],
  ['^12.4', 12], ['~13.4', 13], ['>=12', 12], ['^12 || ^13 || ^14', 12], ['14.0.0-RC1', 14],
  ['^11 || ^12', null], ['>=11', null], ['<=12', null], ['<12', null], ['*', null],
  ['dev-main', null], ['dev-main as 11.5.0', null], ['11.x.4', null], ['>=12 <11', null],
  ['>11.5.0 <=11.5.0', null], ['>=11 <12.0.0-RC1', null], ['>=12.0.0-RC1', 12],
  ['^9999999999999999999999', null], ['^10.4', null], ['^11 ||', null], ['', null], [null, null]
]) test(`Composer constraint ${JSON.stringify(input)}`, () => assert.equal(parseConstraintMajor(input), expected));

test('lockfile package precedence and development packages', () => {
  assert.equal(majorFromLock({ packages: [{ name: 'typo3/cms', version: '12.4.0' }, { name: 'typo3/cms-core', version: '11.5.42' }] }), 11);
  assert.equal(majorFromLock({ 'packages-dev': [{ name: 'typo3/cms-core', version: 'v13.4.0' }] }), 13);
  for (const data of [null, {}, { packages: {} }, { packages: [null, {}, { name: 'typo3/cms-core', version: 'dev-main' }] }]) assert.equal(majorFromLock(data), null);
});

test('requirements take precedence over development requirements', () => {
  assert.equal(majorFromManifest({ require: { 'typo3/cms-core': '^11.5' }, 'require-dev': { 'typo3/cms-core': '^12.4' } }), 11);
  assert.equal(majorFromManifest({ 'require-dev': { 'typo3/cms': '~13.4' } }), 13);
  assert.equal(majorFromManifest(null), null);
});

test('nearest installed lockfile wins over manifest and ancestor projects', async () => {
  const editor = createEditor();
  editor.put('/sites/composer.json', { require: { 'typo3/cms-core': '^13' } });
  editor.put('/sites/shop/composer.json', { require: { 'typo3/cms-core': '^12' } });
  editor.put('/sites/shop/composer.lock', { packages: [{ name: 'typo3/cms-core', version: '11.5.42' }] });
  const detector = createVersionDetector(editor.vscode);
  assert.equal(await detector.detect(editor.document('/sites/shop/packages/site/setup.typoscript')), 11);
  assert.ok(!editor.reads.includes('file:///sites/shop/composer.json'));
});

test('invalid or unrelated lockfiles fall back to requirements', async () => {
  for (const lock of ['invalid JSON', { packages: [{ name: 'other/package', version: '11.0.0' }] }, { packages: 'invalid shape' }]) {
    const editor = createEditor();
    editor.put('/site/composer.lock', lock);
    editor.put('/site/composer.json', { require: { 'typo3/cms-core': '^11.5' } });
    assert.equal(await createVersionDetector(editor.vscode).detect(editor.document('/site/setup.typoscript')), 11);
  }
});

test('an ambiguous nearest TYPO3 project does not inherit an unrelated ancestor version', async () => {
  const editor = createEditor();
  editor.put('/sites/composer.json', { require: { 'typo3/cms-core': '^11' } });
  editor.put('/sites/shop/composer.json', { require: { 'typo3/cms-core': '^11 || ^12' } });
  assert.equal(await createVersionDetector(editor.vscode).detect(editor.document('/sites/shop/setup.typoscript')), null);
});

test('directory cache reuses reads and can be invalidated', async () => {
  const editor = createEditor();
  editor.put('/site/composer.json', { require: { 'typo3/cms-core': '^11' } });
  const detector = createVersionDetector(editor.vscode);
  await Promise.all([detector.detect(editor.document('/site/a.typoscript')), detector.detect(editor.document('/site/b.tsconfig'))]);
  assert.equal(editor.reads.filter((uri) => uri.endsWith('/composer.json')).length, 1);
  editor.put('/site/composer.json', { require: { 'typo3/cms-core': '^12' } });
  detector.clear();
  assert.equal(await detector.detect(editor.documents[0]), 12);
});

test('remote URIs retain their authority and use workspace.fs', async () => {
  const editor = createEditor();
  editor.put('/site/composer.json', { require: { 'typo3/cms-core': '^11' } }, 'vscode-remote', 'ssh-remote+server');
  assert.equal(await createVersionDetector(editor.vscode).detect(editor.document('/site/a.typoscript', 'typoscript', 'vscode-remote', 'ssh-remote+server')), 11);
});

test('unsupported document schemes do not read local files', async () => {
  const editor = createEditor();
  assert.equal(await createVersionDetector(editor.vscode).detect(editor.document('/scratch', 'typoscript', 'untitled')), null);
  assert.equal(editor.reads.length, 0);
});

test('Windows drive roots do not search an unrelated drive-relative root', async () => {
  for (const filename of ['/c:/site/setup.typoscript', '/c:/setup.typoscript']) {
    const editor = createEditor();
    editor.put('/composer.json', { require: { 'typo3/cms-core': '^11' } });
    assert.equal(await createVersionDetector(editor.vscode).detect(editor.document(filename)), null);
    assert.ok(!editor.reads.includes('file:///composer.json'));
    assert.ok(editor.reads.includes('file:///c:/composer.json'));
  }
});

test('UNC shares stop at the share root', async () => {
  const editor = createEditor();
  editor.put('/composer.json', { require: { 'typo3/cms-core': '^11' } }, 'file', 'server');
  assert.equal(await createVersionDetector(editor.vscode).detect(editor.document('/share/site/setup.typoscript', 'typoscript', 'file', 'server')), null);
  assert.ok(!editor.reads.includes('file://server/composer.json'));
  assert.ok(editor.reads.includes('file://server/share/composer.json'));
});

test('unreadable resources are reported and safely fall back', async () => {
  const editor = createEditor();
  const errors = [];
  editor.readHook = async () => { throw Object.assign(new Error('Permission denied'), { code: 'NoPermissions' }); };
  assert.equal(await createVersionDetector(editor.vscode, undefined, (error) => errors.push(error)).detect(editor.document('/site/setup.typoscript')), null);
  assert.ok(errors.length > 0);
});
