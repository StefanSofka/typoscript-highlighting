const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createColorController } = require('../lib/colors');
const { createEditor } = require('./helpers/editor');

function setup(t, loadTokenizer) {
  const editor = createEditor();
  const errors = [];
  const controller = createColorController(editor.vscode, (error) => errors.push(error), loadTokenizer);
  t.after(() => controller.dispose());
  function open(text, language = 'typoscript-v12', filename = '/site/setup.typoscript') {
    const document = editor.document(filename, language);
    document.text = text;
    return editor.textEditor(document);
  }
  function colors(textEditor, palette) { editor.palettes.set(textEditor.document.uri.toString(), palette); }
  function changedColors() { editor.events.configuration.fire({ affectsConfiguration: () => true }); }
  return { editor, controller, errors, open, colors, changedColors };
}

function decoratedText(textEditor, color) {
  const lines = textEditor.document.text.split(/\r\n|\r|\n/);
  return [...textEditor.decorations].filter(([style]) => style.options.color === color)
    .flatMap(([, ranges]) => ranges.map((range) => {
      assert.equal(range.start.line, range.end.line);
      assert.ok(range.end.character <= lines[range.start.line].length);
      return lines[range.start.line].slice(range.start.character, range.end.character);
    }));
}

test('System Default does not load token engines or create decorations', async (t) => {
  const { controller, editor, open } = setup(t, () => { throw new Error('Must not load in default mode'); });
  open('/* comment */\npage = PAGE');
  await controller.refresh();
  assert.equal(editor.styles.length, 0);
});

test('custom categories follow actual grammar scopes, including nested constants', async (t) => {
  const { controller, open, colors } = setup(t);
  const textEditor = open('/* comment */\r\npage = Hello {$site.name}\r\npage < lib.example\r\nvalue := addToList(1)\r\n[foo == 1]\r\n@import "EXT:site/setup.typoscript"\r\npage {\r\n}\r\n');
  const categories = ['comments', 'objectPaths', 'values', 'operators', 'constants', 'conditions', 'imports', 'functions', 'punctuation'];
  colors(textEditor, Object.fromEntries(categories.map((category, index) => [category, `#00000${index + 1}`])));
  await controller.refresh();
  for (const [color, text] of [
    ['#000001', 'comment'], ['#000002', 'lib.example'], ['#000003', 'Hello'],
    ['#000004', ':='], ['#000005', '{$site.name}'], ['#000006', 'foo == 1'],
    ['#000007', 'EXT:site/setup.typoscript'], ['#000008', 'addToList'], ['#000009', '{']
  ]) assert.ok(decoratedText(textEditor, color).some((part) => part.includes(text)), `${text}: ${color}`);
  assert.ok(!decoratedText(textEditor, '#000003').some((part) => part.includes('{$site.name}')));
});

test('unset categories retain theme colors even inside a custom-colored value', async (t) => {
  const { controller, open, colors } = setup(t);
  const textEditor = open('page = Hello {$site.name}');
  colors(textEditor, { values: '#abcdef' });
  await controller.refresh();
  assert.deepEqual(decoratedText(textEditor, '#ABCDEF'), [' Hello ']);
});

test('colors are resource-specific and never apply to another language', async (t) => {
  const { controller, open, colors } = setup(t);
  const first = open('# first', 'typoscript-v11', '/old/setup.typoscript');
  const second = open('# second', 'typoscript-v12', '/new/setup.typoscript');
  const unrelated = open('# javascript', 'javascript', '/new/main.js');
  colors(first, { comments: '#FF0000' });
  colors(second, { comments: '#0000FF' });
  colors(unrelated, { comments: '#00FF00' });
  await controller.refresh();
  assert.deepEqual(decoratedText(first, '#FF0000'), ['# first']);
  assert.deepEqual(decoratedText(second, '#0000FF'), ['# second']);
  assert.equal(decoratedText(unrelated, '#00FF00').length, 0);
});

test('legacy comments, empty modern comments and literal markers keep their semantics', async (t) => {
  const { controller, open, colors } = setup(t);
  const legacy = open('/**/\npage = PAGE\n*/\npage = /**/', 'typoscript-v11', '/old/setup.typoscript');
  const modern = open('/**/\npage = /**/\npage (\n/**/\n)', 'typoscript-v12', '/new/setup.typoscript');
  for (const textEditor of [legacy, modern]) colors(textEditor, { comments: '#FF0000', values: '#0000FF' });
  await controller.refresh();
  assert.ok(decoratedText(legacy, '#FF0000').includes('page = PAGE'));
  assert.ok(!decoratedText(modern, '#FF0000').some((text) => text.includes('page')));
  assert.deepEqual(decoratedText(modern, '#0000FF'), [' /**/', '/**/']);
});

test('clearing custom colors disposes overrides and restores System Default live', async (t) => {
  const { controller, editor, open, colors, changedColors } = setup(t);
  const textEditor = open('# comment');
  colors(textEditor, { comments: '#FF0000' });
  await controller.refresh();
  colors(textEditor, { comments: '' });
  changedColors();
  await controller.whenIdle();
  assert.equal(textEditor.decorations.size, 0);
  assert.ok(editor.styles.every((style) => style.disposed));
});

test('Custom choices use per-resource hex colors, update live and reset to the theme', async (t) => {
  const { controller, editor, open, colors } = setup(t);
  const first = open('# first', 'typoscript-v12', '/first/setup.typoscript');
  const second = open('# second', 'typoscript-v12', '/second/setup.typoscript');
  for (const textEditor of [first, second]) colors(textEditor, { comments: 'custom' });
  editor.customColors.set(first.document.uri.toString(), { comments: '#abcdef' });
  editor.customColors.set(second.document.uri.toString(), { comments: '#123456' });
  await controller.refresh();
  assert.deepEqual(decoratedText(first, '#ABCDEF'), ['# first']);
  assert.deepEqual(decoratedText(second, '#123456'), ['# second']);
  editor.customColors.set(first.document.uri.toString(), { comments: '#654321' });
  editor.events.configuration.fire({ affectsConfiguration: (key) => key === 'typoscriptHighlighting.customColors' });
  await controller.whenIdle();
  assert.deepEqual(decoratedText(first, '#654321'), ['# first']);
  assert.equal(decoratedText(first, '#ABCDEF').length, 0);
  colors(first, { comments: '' });
  await controller.refresh();
  assert.equal(decoratedText(first, '#654321').length, 0);
  assert.deepEqual(decoratedText(second, '#123456'), ['# second']);
});

test('Custom with missing, invalid or empty hex values retains System Default without loading engines', async (t) => {
  const { controller, editor, open, colors } = setup(t, () => { throw new Error('Must not load'); });
  const textEditor = open('# comment');
  colors(textEditor, { comments: 'custom' });
  for (const value of [undefined, {}, { comments: '' }, { comments: '#123' }, { comments: 'red' }, null]) {
    editor.customColors.set(textEditor.document.uri.toString(), value);
    await controller.refresh();
    assert.equal(editor.styles.length, 0);
  }
});

test('edits recompute multiline comment state and restore following statements', async (t) => {
  const { controller, editor, open, colors } = setup(t);
  const textEditor = open('/* comment\npage = PAGE');
  colors(textEditor, { comments: '#FF0000', operators: '#0000FF' });
  await controller.refresh();
  assert.ok(decoratedText(textEditor, '#FF0000').includes('page = PAGE'));
  textEditor.document.text = '/* comment */\npage = PAGE';
  textEditor.document.version++;
  editor.events.text.fire({ document: textEditor.document });
  await controller.whenIdle();
  assert.ok(!decoratedText(textEditor, '#FF0000').includes('page = PAGE'));
  assert.deepEqual(decoratedText(textEditor, '#0000FF'), ['=']);
});

test('changing settings while token engines load discards obsolete colors', async (t) => {
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const tokenizer = { tokenize: () => [{ category: 'comments', line: 0, start: 0, end: 9 }], dispose() {} };
  const { controller, open, colors, changedColors } = setup(t, async () => { await blocked; return tokenizer; });
  const textEditor = open('# comment');
  colors(textEditor, { comments: '#FF0000' });
  const initial = controller.refresh();
  colors(textEditor, { comments: '#0000FF' });
  changedColors();
  release();
  await initial;
  await controller.whenIdle();
  assert.equal(decoratedText(textEditor, '#FF0000').length, 0);
  assert.deepEqual(decoratedText(textEditor, '#0000FF'), ['# comment']);
});

test('closed documents and disposal prevent late decorations', async (t) => {
  let release;
  let disposed = false;
  const blocked = new Promise((resolve) => { release = resolve; });
  const { controller, editor, open, colors } = setup(t, async () => {
    await blocked;
    return { tokenize() { throw new Error('Must not tokenize after disposal'); }, dispose() { disposed = true; } };
  });
  const textEditor = open('# comment');
  colors(textEditor, { comments: '#FF0000' });
  const initial = controller.refresh();
  controller.dispose();
  textEditor.document.isClosed = true;
  release();
  await initial;
  assert.equal(editor.styles.length, 0);
  assert.equal(disposed, true);
});

test('invalid colors use System Default and engine failures are reported', async (t) => {
  const { controller, editor, errors, open, colors } = setup(t, () => { throw new Error('Engine unavailable'); });
  const textEditor = open('# comment');
  colors(textEditor, { comments: 'red', operators: '#12345678' });
  await controller.refresh();
  assert.equal(editor.styles.length, 0);
  assert.equal(errors.length, 0);
  colors(textEditor, { comments: '#FF0000' });
  await controller.refresh();
  assert.equal(errors.length, 1);
});
