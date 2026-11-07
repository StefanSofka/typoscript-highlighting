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

test('Marketplace icon contains PNG image data with supported dimensions', () => {
  const icon = fs.readFileSync(path.join(__dirname, '..', manifest.icon));
  assert.equal(path.extname(manifest.icon).toLowerCase(), '.png');
  assert.deepEqual(icon.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 'The icon must be a real PNG, not another format with a .png extension');
  assert.equal(icon.readUInt32BE(8), 13, 'PNG must start with its complete image header');
  assert.equal(icon.toString('ascii', 12, 16), 'IHDR');
  assert.ok(icon.readUInt32BE(16) >= 128 && icon.readUInt32BE(20) >= 128, 'Marketplace icons must be at least 128 pixels wide and high');
});

test('runtime dependencies contain the token engines and static YAML parser', () => {
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), ['jsonc-parser', 'vscode-oniguruma', 'vscode-textmate', 'yaml']);
  assert.ok(manifest.devDependencies['@vscode/vsce']);
  assert.equal(lock.version, manifest.version);
  assert.equal(lock.packages[''].version, manifest.version);
  assert.deepEqual(lock.packages[''].devDependencies, manifest.devDependencies);
  assert.deepEqual(lock.packages[''].dependencies, manifest.dependencies);
});

test('saved colors are grouped behind the visual editor instead of nine native fields', () => {
  const { TOKEN_CATEGORIES } = require('../lib/tokenizer');
  for (const category of Object.keys(TOKEN_CATEGORIES)) {
    const setting = manifest.contributes.configuration.properties['typoscriptHighlighting.customTheme'].properties.colors.properties[category];
    assert.equal(setting.default, '');
    assert.equal(setting.type, 'string');
    assert.equal(setting.enum, undefined, 'color fields must not render dropdowns');
    assert.equal(manifest.contributes.configuration.properties[`typoscriptHighlighting.colors.${category}`], undefined);
    const pattern = new RegExp(setting.pattern);
    for (const value of ['', '#123456', '#aBcDeF']) assert.ok(pattern.test(value));
    for (const value of ['red', '#123', '#12345678', '#12345Z']) assert.ok(!pattern.test(value));
    assert.ok(pattern.test('custom'), 'retain compatibility with 1.2.0 settings');
  }
  assert.ok(manifest.contributes.commands.some(({ command }) => command === 'typoscriptHighlighting.configureColors'));
  assert.ok(manifest.activationEvents.includes('onCommand:typoscriptHighlighting.configureColors'));
  const saved = manifest.contributes.configuration.properties['typoscriptHighlighting.customTheme'];
  assert.equal(saved.scope, 'resource');
  assert.deepEqual(saved.type, ['object']);
  assert.ok(saved.markdownDescription.includes('command:typoscriptHighlighting.configureColors'));
  assert.deepEqual(Object.keys(manifest.contributes.configuration.properties).sort(), [
    'typoscriptHighlighting.customTheme', 'typoscriptHighlighting.diagnostics.enabled', 'typoscriptHighlighting.formatting.enabled',
    'typoscriptHighlighting.theme', 'typoscriptHighlighting.typo3Version'
  ]);
});

test('legacy Comment Rules remain valid inside preserved theme data', () => {
  const setting = manifest.contributes.configuration.properties['typoscriptHighlighting.customTheme'].properties.legacy.properties.commentRules;
  assert.equal(setting.default, 'auto');
  assert.deepEqual(setting.enum, ['auto', 'v11', 'v12', 'v13', 'v14']);
  assert.equal(setting.enumItemLabels.length, setting.enum.length);
  assert.equal(setting.enumDescriptions.length, setting.enum.length);
});

test('the extension menu opens the visual Theme Settings page only for this extension', () => {
  const command = manifest.contributes.commands.find(({ command }) => command === 'typoscriptHighlighting.configureColors');
  assert.equal(command.title, 'Theme Settings');
  const item = manifest.contributes.menus['extension/context'].find(({ command }) => command === 'typoscriptHighlighting.configureColors');
  assert.equal(item.when, 'extension == stefan-sofka.typoscript-highlighting && extensionStatus == installed');
  assert.ok(!manifest.contributes.commands.some(({ command }) => command === 'typoscriptHighlighting.editCustomTheme'), 'one visible settings command; keep the old ID as a compatibility alias');
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
