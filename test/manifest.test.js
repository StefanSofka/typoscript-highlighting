const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const manifest = require('../package.json');
const lock = require('../package-lock.json');
const configuration = require('../language-configuration.json');

test('all manifest resources exist and grammar scopes match their files', () => {
  for (const file of [manifest.main, manifest.icon, ...manifest.contributes.languages.map((language) => language.configuration)]) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', file)), file);
  }
  const registered = new Map();
  for (const grammar of manifest.contributes.grammars) {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', grammar.path), 'utf8'));
    assert.equal(data.scopeName, grammar.scopeName);
    if (registered.has(grammar.scopeName)) assert.equal(registered.get(grammar.scopeName), grammar.path, 'a scope must not map to two files');
    registered.set(grammar.scopeName, grammar.path);
  }
});

test('packaging tools and test engines are development dependencies', () => {
  assert.equal(manifest.dependencies, undefined);
  assert.ok(manifest.devDependencies['@vscode/vsce']);
  assert.equal(lock.version, manifest.version);
  assert.equal(lock.packages[''].version, manifest.version);
  assert.deepEqual(lock.packages[''].devDependencies, manifest.devDependencies);
});

test('language configuration defines comments, matching pairs, indentation and folding', () => {
  assert.equal(configuration.comments.lineComment, '#');
  assert.deepEqual(configuration.comments.blockComment, ['/*', '*/']);
  const increase = new RegExp(configuration.indentationRules.increaseIndentPattern);
  const decrease = new RegExp(configuration.indentationRules.decreaseIndentPattern);
  assert.ok(increase.test('page {'));
  assert.ok(increase.test('page.10.value ('));
  assert.ok(!increase.test('page.10.value = ('));
  assert.ok(!increase.test('# page {'));
  assert.ok(!increase.test('value = ignored {'));
  assert.ok(decrease.test('  )'));
  assert.ok(decrease.test('  }'));
  assert.ok(new RegExp(configuration.folding.markers.start).test('# region Example'));
  assert.ok(new RegExp(configuration.folding.markers.end).test('// endregion'));
});

test('legacy editing avoids generating unsupported inline block comments', () => {
  const legacy = require('../language-configuration-v11.json');
  assert.equal(legacy.comments.lineComment, '#');
  assert.equal(legacy.comments.blockComment, undefined);
  assert.deepEqual(legacy.brackets, configuration.brackets);
});
