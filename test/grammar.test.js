const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const tm = require('vscode-textmate');
const onig = require('vscode-oniguruma');
const manifest = require('../package.json');
const registries = [];
const grammars = new Map();

before(async () => {
  const wasm = fs.readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'));
  await onig.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
  // Use one registry and the manifest mappings to catch scope collisions.
  const definitions = new Map();
  for (const definition of manifest.contributes.grammars) {
    if (definitions.has(definition.scopeName)) assert.equal(definitions.get(definition.scopeName).path, definition.path);
    definitions.set(definition.scopeName, definition);
  }
  const registry = new tm.Registry({
    onigLib: Promise.resolve({ createOnigScanner: (patterns) => new onig.OnigScanner(patterns), createOnigString: (text) => new onig.OnigString(text) }),
    loadGrammar: async (scope) => {
      const definition = definitions.get(scope);
      return definition ? tm.parseRawGrammar(fs.readFileSync(path.join(__dirname, '..', definition.path), 'utf8'), definition.path) : null;
    }
  });
  registries.push(registry);
  for (const definition of manifest.contributes.grammars) grammars.set(definition.language, await registry.loadGrammar(definition.scopeName));
});
after(() => registries.forEach((registry) => registry.dispose()));

function tokenize(language, lines) {
  let state = tm.INITIAL;
  return lines.map((line) => {
    const result = grammars.get(language).tokenizeLine(line, state);
    state = result.ruleStack;
    return result.tokens.map((token) => ({ ...token, text: line.slice(token.startIndex, token.endIndex) }));
  });
}

function scoped(tokens, text, scope) {
  assert.ok(tokens.some((token) => token.text.includes(text) && token.scopes.includes(scope)),
    `${JSON.stringify(text)} should have ${scope}: ${JSON.stringify(tokens)}`);
}

function noComments(tokens) {
  assert.ok(tokens.every((token) => token.scopes.every((scope) => !scope.startsWith('comment.'))), JSON.stringify(tokens));
}

for (const language of ['typoscript-v11', 'typoscript-v12']) {
  test(`${language}: assignment values retain all comment markers`, () => {
    const [tokens] = tokenize(language, ['page.10.value = https://example.org/#anchor /* literal */']);
    scoped(tokens, 'page.10.value', 'variable.parameter.typoscript');
    scoped(tokens, '=', 'keyword.operator.equals.typoscript');
    scoped(tokens, 'https://example.org/#anchor /* literal */', 'string.value.typoscript');
    noComments(tokens);
  });

  for (const objectPath of ['my-object', 'my\\.object', 'page.10', 'plugin.tx_site.settings.some-key']) {
    test(`${language}: object path ${objectPath}`, () => {
      const [tokens] = tokenize(language, [`${objectPath} = TEXT`]);
      scoped(tokens, objectPath, 'variable.parameter.typoscript');
    });
  }

  test(`${language}: complete reference and copy operators`, () => {
    for (const operator of ['<', '=<']) {
      const [tokens] = tokenize(language, [`page.20 ${operator} .10`]);
      scoped(tokens, operator, 'keyword.operator.reference.typoscript');
      scoped(tokens, '.10', 'variable.other.reference.typoscript');
    }
    const [tokens] = tokenize(language, ['page.10.value = <p>value</p>']);
    scoped(tokens, '<p>value</p>', 'string.value.typoscript');
  });

  test(`${language}: multiline values suppress syntax and restore the next statement`, () => {
    const lines = tokenize(language, ['page.10.value (', '  # literal // literal', '  inner = text', "  @import 'literal'", '  [END]', '  value {$site.name}', ')', 'page.20 = TEXT']);
    scoped(lines[0], 'page.10.value', 'variable.parameter.typoscript');
    scoped(lines[0], '(', 'punctuation.definition.string.begin.typoscript');
    for (const tokens of lines.slice(1, 6)) {
      noComments(tokens);
      assert.ok(tokens.every((token) => token.scopes.includes('string.value.multiline.typoscript')));
      assert.ok(tokens.every((token) => !token.scopes.includes('keyword.control.import.typoscript')));
    }
    scoped(lines[5], '{$site.name}', 'constant.other.typoscript');
    scoped(lines[6], ')', 'punctuation.definition.string.end.typoscript');
    scoped(lines[7], 'page.20', 'variable.parameter.typoscript');
    assert.ok(lines[7].every((token) => !token.scopes.includes('string.value.multiline.typoscript')));
  });

  test(`${language}: an equals sign followed by a parenthesis is a single-line value`, () => {
    const lines = tokenize(language, ['page.10.value = (', '# real comment', 'page.20 = TEXT']);
    scoped(lines[0], '(', 'string.value.typoscript');
    assert.ok(lines[0].every((token) => !token.scopes.includes('string.value.multiline.typoscript')));
    scoped(lines[1], '# real comment', 'comment.line.number-sign.typoscript');
    scoped(lines[2], 'page.20', 'variable.parameter.typoscript');
  });

  test(`${language}: nested blocks have punctuation and paths`, () => {
    const lines = tokenize(language, ['page {', '  10 {', '    value = text', '  }', '}']);
    scoped(lines[0], 'page', 'variable.parameter.typoscript');
    scoped(lines[1], '{', 'punctuation.section.block.typoscript');
    scoped(lines[3], '}', 'punctuation.section.block.typoscript');
    scoped(lines[4], '}', 'punctuation.section.block.typoscript');
  });

  test(`${language}: modifiers retain literal arguments and nested parentheses`, () => {
    const [tokens] = tokenize(language, ['value := prependString(url(#anchor) https://example.org/)']);
    scoped(tokens, ':=', 'keyword.operator.modification.typoscript');
    scoped(tokens, 'prependString', 'support.function.typoscript');
    scoped(tokens, '#anchor', 'string.value.typoscript');
    noComments(tokens);
  });

  test(`${language}: condition strings and nested array access retain their outer scope`, () => {
    const line = '[traverse(request.getQueryParams(), "filters[category]") == request["id"]]';
    const [tokens] = tokenize(language, [line]);
    assert.ok(tokens.filter((token) => token.text.trim()).every((token) => token.scopes.includes('keyword.control.block.typoscript')));
    scoped(tokens, '"filters[category]"', 'string.quoted.double.typoscript');
  });

  for (const ending of ['[END]', '[end]', '[GLOBAL]', '[global]']) test(`${language}: ${ending} closes a condition`, () => {
    scoped(tokenize(language, [ending])[0], ending, 'keyword.control.endblock.typoscript');
  });

  test(`${language}: ELSE has a dedicated scope`, () => {
    scoped(tokenize(language, ['[ELSE]'])[0], '[ELSE]', 'keyword.control.else.typoscript');
  });

  test(`${language}: an unfinished condition does not consume the next line`, () => {
    for (const statement of ['[broken condition', '[request["missing close"', 'value := addToList(1', '<INCLUDE_TYPOSCRIPT: source="broken"']) {
      const lines = tokenize(language, [statement, 'page = PAGE']);
      scoped(lines[1], 'page', 'variable.parameter.typoscript');
    }
  });

  test(`${language}: constants inside values`, () => {
    scoped(tokenize(language, ['value = Hello {$site.name}'])[0], '{$site.name}', 'constant.other.typoscript');
  });

  for (const quote of ["'", '"']) test(`${language}: ${quote} quoted imports protect comment markers in paths`, () => {
    const [tokens] = tokenize(language, [`@import ${quote}EXT:site/Configuration/*.typoscript${quote}`]);
    scoped(tokens, '@import', 'keyword.control.import.typoscript');
    scoped(tokens, 'EXT:site/Configuration/*.typoscript', 'string.path.typoscript');
    noComments(tokens);
  });

  test(`${language}: legacy INCLUDE_TYPOSCRIPT paths`, () => {
    const [tokens] = tokenize(language, ['<INCLUDE_TYPOSCRIPT: source="FILE:EXT:site/setup.typoscript">']);
    scoped(tokens, '<INCLUDE_TYPOSCRIPT:', 'keyword.control.import.typoscript');
    scoped(tokens, 'FILE:EXT:site/setup.typoscript', 'string.path.typoscript');
  });

  test(`${language}: block comments close according to the selected version`, () => {
    const lines = tokenize(language, ['/* comment', 'inside comment', '*/', 'page = PAGE']);
    scoped(lines[1], 'inside comment', 'comment.block.typoscript');
    scoped(lines[3], 'page', 'variable.parameter.typoscript');
  });

  test(`${language}: documentation comments`, () => {
    const lines = tokenize(language, ['/** documentation', 'details', '*/', 'page = PAGE']);
    scoped(lines[1], 'details', 'comment.block.documentation.typoscript');
    scoped(lines[3], 'page', 'variable.parameter.typoscript');
  });
}

test('v12 inline comments after non-assignment operators and conditions', () => {
  for (const code of ['page.10 >', 'page.20 < page.10', 'page.20 =< page.10', 'value := addToList(1)', '[foo == 1]', '[END]', 'page {', '}']) {
    for (const marker of ['#', '//', '/*']) {
      const [tokens] = tokenize('typoscript-v12', [`${code} ${marker} comment${marker === '/*' ? ' */' : ''}`]);
      assert.ok(tokens.some((token) => token.text.includes('comment') && token.scopes.some((scope) => scope.startsWith('comment.'))), `${code} ${marker}`);
    }
  }
});

test('v12 code after an inline block comment is still tokenized', () => {
  const [tokens] = tokenize('typoscript-v12', ['/* comment */ page = PAGE']);
  scoped(tokens, 'page', 'variable.parameter.typoscript');
  scoped(tokens, 'PAGE', 'string.value.typoscript');
});

test('registered v11 and v12 modes use distinct block comment rules', () => {
  const v11 = tokenize('typoscript-v11', ['/* one line */', 'page = PAGE']);
  const v12 = tokenize('typoscript-v12', ['/* one line */', 'page = PAGE']);
  scoped(v11[1], 'page = PAGE', 'comment.block.typoscript');
  scoped(v12[1], 'page', 'variable.parameter.typoscript');
});

test('v11 imports inside block comments are still recognized', () => {
  const lines = tokenize('typoscript-v11', ['/* comment', "@import 'EXT:site/setup.typoscript'", '*/']);
  scoped(lines[1], '@import', 'keyword.control.import.typoscript');
});

test('v11 inline markers after copy are not treated as comments', () => {
  noComments(tokenize('typoscript-v11', ['page.20 < page.10 # inline'])[0]);
});
