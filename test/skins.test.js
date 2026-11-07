const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createEditor } = require('./helpers/editor');
const { readColors, createColorController } = require('../lib/colors');
const { getColors, getSkin } = require('../lib/palette');
const { SKINS, SKIN_OPTIONS, resolveSkin } = require('../lib/skins');
const { TOKEN_CATEGORIES } = require('../lib/tokenizer');
const manifest = require('../package.json');

test('installation defaults to Automatic and ships five complete, distinct skins', () => {
  const setting = manifest.contributes.configuration.properties['typoscriptHighlighting.customTheme'].properties.legacy.properties.skin;
  assert.equal(setting.default, 'auto');
  assert.deepEqual(setting.enum, SKIN_OPTIONS.map(({ id }) => id));
  assert.deepEqual(setting.enumItemLabels, SKIN_OPTIONS.map(({ label }) => label));
  assert.equal(setting.enumDescriptions.length, setting.enum.length);
  assert.equal(SKINS.length, 5);
  for (const palette of ['dark', 'light']) {
    const palettes = SKINS.map(({ id }) => resolveSkin(id, palette).colors);
    assert.equal(new Set(palettes.map((colors) => JSON.stringify(colors))).size, 5);
    for (const colors of palettes) {
      assert.deepEqual(Object.keys(colors), Object.keys(TOKEN_CATEGORIES));
      assert.ok(Object.values(colors).every((color) => /^#[0-9A-F]{6}$/.test(color)));
    }
  }
});

test('unconfigured documents use Light or Dark, including matching high contrast modes', () => {
  const editor = createEditor();
  const document = editor.document('/site/setup.typoscript');
  for (const [kind, expected] of [[1, 'light'], [2, 'dark'], [3, 'dark'], [4, 'light']]) {
    editor.vscode.window.activeColorTheme = { kind };
    assert.deepEqual(readColors(editor.vscode, document.uri), resolveSkin(expected, expected).colors);
  }
  assert.equal(editor.settings.size, 0);
  assert.equal(editor.skins.size, 0);
});

test('Automatic recolors an open file on theme changes without reloading the tokenizer', async (t) => {
  const editor = createEditor();
  const document = editor.document('/site/setup.typoscript');
  document.text = '# comment';
  const view = editor.textEditor(document);
  let loads = 0, tokenizations = 0;
  const controller = createColorController(editor.vscode, (error) => { throw error; }, () => {
    loads++;
    return { tokenize() { tokenizations++; return [{ category: 'comments', line: 0, start: 0, end: 9 }]; }, dispose() {} };
  });
  t.after(() => controller.dispose());
  const visible = () => [...view.decorations].filter(([, ranges]) => ranges.length).map(([style]) => style.options.color);
  await controller.refresh();
  assert.deepEqual(visible(), ['#7FA870']);
  editor.vscode.window.activeColorTheme = { kind: 1 };
  editor.events.theme.fire({ kind: 1 });
  await controller.whenIdle();
  assert.deepEqual(visible(), ['#426B35']);
  assert.equal(loads, 1);
  assert.equal(tokenizations, 1);
  assert.equal(editor.skins.size, 0, 'automatic selection must not write a skin setting');
});

test('skin changes apply live, remain per-resource and leave other languages alone', async (t) => {
  const editor = createEditor();
  const documents = ['/first/setup.typoscript', '/second/setup.typoscript', '/second/example.js']
    .map((filename, index) => editor.document(filename, index === 2 ? 'javascript' : 'typoscript-v12'));
  const views = documents.map((document) => { document.text = '# comment'; return editor.textEditor(document); });
  const controller = createColorController(editor.vscode, (error) => { throw error; });
  t.after(() => controller.dispose());
  await controller.refresh();
  editor.skins.set(documents[0].uri.toString(), 'nord');
  editor.events.configuration.fire({ affectsConfiguration: (key) => key === 'typoscriptHighlighting.skin' });
  await controller.whenIdle();
  const visible = (view) => [...view.decorations].filter(([, ranges]) => ranges.length).map(([style]) => style.options.color);
  assert.deepEqual(visible(views[0]), ['#A3BE8C']);
  assert.deepEqual(visible(views[1]), ['#7FA870']);
  assert.deepEqual(visible(views[2]), []);
});

test('custom and palette colors override skins; an explicit empty value selects native theme colors', () => {
  const editor = createEditor();
  const uri = editor.document('/site/setup.typoscript').uri;
  editor.skins.set(uri.toString(), 'nord');
  editor.palettes.set(uri.toString(), { comments: '#123456', values: '' });
  editor.variants.set(uri.toString(), { darkColors: { comments: '', constants: '#ABCDEF' } });
  const dark = readColors(editor.vscode, uri);
  assert.equal(dark.comments, undefined);
  assert.equal(dark.values, undefined);
  assert.equal(dark.constants, '#ABCDEF');
  assert.equal(dark.objectPaths, '#88C0D0');
  editor.vscode.window.activeColorTheme = { kind: 1 };
  const light = readColors(editor.vscode, uri);
  assert.equal(light.comments, '#123456');
  assert.equal(light.values, undefined);
  assert.equal(light.constants, '#944B2B');
  editor.palettes.delete(uri.toString());
  assert.equal(readColors(editor.vscode, uri).values, '#775914');
  editor.skins.set(uri.toString(), 'editor');
  assert.deepEqual(readColors(editor.vscode, uri), {});
  editor.skins.set(uri.toString(), 'invalid');
  assert.equal(readColors(editor.vscode, uri).comments, '#426B35');
});

test('picker previews the skin at its selected scope and identifies more specific settings', () => {
  const editor = createEditor();
  const uri = editor.document('/site/setup.typoscript').uri;
  const layers = { skin: { defaultValue: 'auto', globalValue: 'nord', workspaceValue: 'monokai', workspaceFolderValue: 'light' },
    'colors.comments': { defaultValue: '', workspaceValue: '' } };
  editor.vscode.workspace.getConfiguration = () => ({ inspect: (key) => layers[key] || {} });
  assert.equal(getSkin(editor.vscode, { id: 'user' }, 'base', uri).overridden, true);
  for (const [id, label, color] of [['user', 'Nord', '#A3BE8C'], ['workspace', 'Monokai', ''], ['folder:test', 'Light', '']]) {
    const target = { id, uri };
    assert.equal(getSkin(editor.vscode, target).label, label);
    const comment = getColors(editor.vscode, target).find(({ category }) => category === 'comments');
    assert.equal(comment.color, color);
    assert.equal(comment.source, id === 'user' ? 'Nord skin' : 'Workspace');
  }
});

test('a selected preset ignores saved custom colors without deleting them', () => {
  const editor = createEditor();
  const uri = editor.document('/site/setup.typoscript').uri;
  editor.palettes.set(uri.toString(), { comments: '#123456' });
  editor.variants.set(uri.toString(), { darkColors: { values: '#ABCDEF' } });
  for (const theme of ['auto', ...SKINS.map(({ id }) => id)]) {
    editor.themes.set(uri.toString(), theme);
    assert.deepEqual(readColors(editor.vscode, uri), resolveSkin(theme, 'dark').colors);
  }
  assert.equal(editor.palettes.get(uri.toString()).comments, '#123456');
  editor.themes.set(uri.toString(), 'custom');
  assert.equal(readColors(editor.vscode, uri).comments, '#123456');
  assert.notEqual(readColors(editor.vscode, uri).values, '#ABCDEF', 'Custom uses one palette rather than dark/light overrides');
});

test('Theme is exposed directly in Settings with exactly the ready/custom choices', () => {
  const setting = manifest.contributes.configuration.properties['typoscriptHighlighting.theme'];
  assert.equal(setting.default, 'auto');
  assert.deepEqual(setting.enum, ['auto', 'dark', 'light', 'nord', 'monokai', 'solarized', 'custom']);
  assert.ok(setting.markdownDescription.includes('command:typoscriptHighlighting.configureColors'));
  assert.equal(manifest.contributes.configuration.properties['typoscriptHighlighting.darkColors'], undefined);
  assert.equal(manifest.contributes.configuration.properties['typoscriptHighlighting.lightColors'], undefined);
});
