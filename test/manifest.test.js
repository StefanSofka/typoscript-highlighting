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

test('only the custom-color token engines are runtime dependencies', () => {
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), ['vscode-oniguruma', 'vscode-textmate']);
  assert.ok(manifest.devDependencies['@vscode/vsce']);
  assert.equal(lock.version, manifest.version);
  assert.equal(lock.packages[''].version, manifest.version);
  assert.deepEqual(lock.packages[''].devDependencies, manifest.devDependencies);
  assert.deepEqual(lock.packages[''].dependencies, manifest.dependencies);
});

test('every color accepts direct hex and links to the spectrum picker with System Default', () => {
  const { TOKEN_CATEGORIES } = require('../lib/tokenizer');
  for (const category of Object.keys(TOKEN_CATEGORIES)) {
    const setting = manifest.contributes.configuration.properties[`typoscriptHighlighting.colors.${category}`];
    assert.equal(setting.default, '');
    assert.equal(setting.scope, 'resource');
    assert.equal(setting.type, 'string');
    assert.equal(setting.enum, undefined, 'color fields must not render dropdowns');
    assert.ok(setting.markdownDescription.includes('command:typoscriptHighlighting.configureColors?'));
    const pattern = new RegExp(setting.pattern);
    for (const value of ['', '#123456', '#aBcDeF']) assert.ok(pattern.test(value));
    for (const value of ['red', '#123', '#12345678', '#12345Z']) assert.ok(!pattern.test(value));
    assert.ok(pattern.test('custom'), 'retain compatibility with 1.2.0 settings');
  }
  assert.ok(manifest.contributes.commands.some(({ command }) => command === 'typoscriptHighlighting.configureColors'));
  assert.ok(manifest.activationEvents.includes('onCommand:typoscriptHighlighting.configureColors'));
  assert.ok(manifest.contributes.configuration.properties['typoscriptHighlighting.customColors'].deprecationMessage);
});

test('Comment Rules provides explicit TYPO3 11 through 14 dropdown entries', () => {
  const setting = manifest.contributes.configuration.properties['typoscriptHighlighting.commentRules'];
  assert.equal(setting.default, 'auto');
  assert.deepEqual(setting.enum, ['auto', 'v11', 'v12', 'v13', 'v14']);
  assert.equal(setting.enumItemLabels.length, setting.enum.length);
  assert.equal(setting.enumDescriptions.length, setting.enum.length);
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
