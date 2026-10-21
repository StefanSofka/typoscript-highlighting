const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parse, formatIndentation } = require('../lib/parser');

test('structure preserves nested object paths and ignores syntax in assignment and multiline values', () => {
  const parsed = parse('lib {\r\n title = Hello { # not a comment\r\n text (\r\n@import "ignored.typoscript"\r\n# {$site.name}\r\n)\r\n}\r\n');
  assert.deepEqual(parsed.nodes.map((n) => [n.kind, n.path]), [['block', 'lib'], ['assignment', 'lib.title'], ['multiline', 'lib.text']]);
  assert.equal(parsed.imports.length, 0);
  assert.equal(parsed.references[0].name, 'site.name');
  assert.deepEqual(parsed.errors, []);
  assert.ok(parsed.folds.some((f) => f.kind === 'value'));
});

test('comments, empty comments and inline comment suffixes respect each grammar family', () => {
  assert.equal(parse('/* a */ lib.foo = {$value}').references.length, 1);
  assert.equal(parse('/**/\nlib.foo = TEXT').nodes.length, 1);
  assert.equal(parse('/**/\nlib.foo = TEXT', 'typoscript-v11').nodes.length, 0);
  assert.equal(parse('/*\n@import "./legacy.typoscript"\n*/', 'typoscript-v11').imports.length, 1);
  assert.equal(parse('/*\n@import "./ignored.typoscript"\n*/').imports.length, 0);
});

test('conditions protect quotes and nested brackets, replace previous conditions and may end at EOF', () => {
  const parsed = parse('[foo["x]"] == 1]\npage = PAGE\n[ELSE]\npage = TEXT\n[END]\n[site("identifier") == "main"]\npage = PAGE');
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.roots.filter((n) => n.kind === 'condition').length, 3);
  assert.equal(parsed.roots[0].children[0].name, 'page');
  assert.equal(parse('[broken').errors[0].code, 'condition');
});

test('legacy imports expose exact source and only offer safe automatic migration', () => {
  const parsed = parse('<INCLUDE_TYPOSCRIPT: source="FILE:EXT:site/setup.typoscript">\n<INCLUDE_TYPOSCRIPT: source="FILE:EXT:site/setup.txt" extensions="txt">');
  assert.equal(parsed.imports[0].path, 'EXT:site/setup.typoscript');
  assert.equal(parsed.imports[0].canMigrate, true);
  assert.equal(parsed.imports[1].canMigrate, false);
});

test('conservative formatting changes leading code indentation, preserving values and EOLs', () => {
  const source = 'lib {\nvalue =  literal  \ntext (\n   keep this indentation  \n)\n}\n';
  const apply = (text) => {
    const parsed = parse(text);
    const lines = [...parsed.lines];
    for (const edit of formatIndentation(parsed, { insertSpaces: true, tabSize: 2 })) lines[edit.line] = edit.text + lines[edit.line].slice(edit.end);
    return lines.join('\n');
  };
  const formatted = apply(source);
  assert.ok(formatted.includes('  value =  literal  '));
  assert.ok(formatted.includes('\n   keep this indentation  \n'));
  assert.equal(apply(formatted), formatted);
  assert.deepEqual(formatIndentation(parse('lib {'), { insertSpaces: true, tabSize: 2 }), []);
});

test('region folding remains available without treating value text as markers', () => {
  const parsed = parse('# region Site\npage = PAGE\n# endregion\nvalue (\n# region literal\n)');
  assert.equal(parsed.folds.filter((item) => item.kind === 'region').length, 1);
});

test('modern trailing block comments carry state after imports, blocks, conditions and multiline closers', () => {
  for (const source of [
    'lib.copy < lib.other /* comment\nignored = TEXT\n*/\nreal = TEXT',
    '@import "./a.typoscript" /* comment\nignored = TEXT\n*/\nreal = TEXT',
    '[true] /* comment\nignored = TEXT\n*/\nreal = TEXT\n[END]',
    'lib { /* comment\nignored = TEXT\n*/\nreal = TEXT\n}',
    'value (\nliteral\n) /* comment\nignored = TEXT\n*/\nreal = TEXT'
  ]) {
    const parsed = parse(source);
    assert.ok(!parsed.nodes.some((node) => node.name === 'ignored'), source);
    assert.ok(parsed.nodes.some((node) => node.name === 'real'), source);
    assert.deepEqual(parsed.errors, [], source);
  }
  const refs = parse('lib.copy < lib.other # {$ignored}\nvalue := addToList({$argument}, # literal) // {$ignored}\nvalue = # {$literal}').references;
  assert.deepEqual(refs.map((item) => item.name), ['argument', 'literal']);
});
