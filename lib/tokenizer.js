const fs = require('node:fs/promises');
const path = require('node:path');

const TOKEN_CATEGORIES = {
  comments: [
    'comment.block.typoscript', 'comment.block.documentation.typoscript',
    'comment.line.double-slash.typoscript', 'comment.line.number-sign.typoscript',
    'comment.line.ignored.typoscript', 'punctuation.definition.comment.begin.typoscript',
    'punctuation.definition.comment.end.typoscript'
  ],
  objectPaths: ['variable.parameter.typoscript', 'variable.other.reference.typoscript'],
  values: ['string.value.typoscript', 'string.quoted.single.typoscript', 'string.quoted.double.typoscript'],
  operators: [
    'keyword.operator.equals.typoscript', 'keyword.operator.reference.typoscript',
    'keyword.operator.modification.typoscript', 'keyword.operator.unset.typoscript'
  ],
  constants: ['constant.other.typoscript'],
  conditions: [
    'keyword.control.block.typoscript', 'keyword.control.endblock.typoscript',
    'keyword.control.else.typoscript', 'punctuation.section.condition.begin.typoscript',
    'punctuation.section.condition.end.typoscript'
  ],
  imports: ['keyword.control.import.typoscript', 'string.path.typoscript', 'entity.other.attribute-name.typoscript'],
  functions: ['support.function.typoscript'],
  punctuation: [
    'punctuation.section.block.typoscript', 'punctuation.section.arguments.begin.typoscript',
    'punctuation.section.arguments.end.typoscript', 'punctuation.definition.string.begin.typoscript',
    'punctuation.definition.string.end.typoscript', 'punctuation.definition.tag.end.typoscript'
  ]
};
const categoriesByScope = new Map(Object.entries(TOKEN_CATEGORIES)
  .flatMap(([category, scopes]) => scopes.map((scope) => [scope, category])));
let onigurumaReady;

function categoryForScopes(scopes) {
  for (let index = scopes.length - 1; index >= 0; index--) {
    const category = categoriesByScope.get(scopes[index]);
    if (category) return category;
  }
  return null;
}

async function createTokenizer() {
  // Load the engines only when a visible document has a custom color.
  const tm = require('vscode-textmate');
  const onig = require('vscode-oniguruma');
  if (!onigurumaReady) {
    onigurumaReady = fs.readFile(require.resolve('vscode-oniguruma/release/onig.wasm'))
      .then((wasm) => onig.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength)))
      .catch((error) => { onigurumaReady = undefined; throw error; });
  }
  await onigurumaReady;
  const definitions = new Map([
    ['source.typoscript', 'typoscript.tmLanguage.json'],
    ['source.typoscript.v11', 'typoscript-v11.tmLanguage.json']
  ]);
  const registry = new tm.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (patterns) => new onig.OnigScanner(patterns),
      createOnigString: (text) => new onig.OnigString(text)
    }),
    loadGrammar: async (scope) => {
      const name = definitions.get(scope);
      if (!name) return null;
      const filename = path.join(__dirname, '..', 'syntaxes', name);
      return tm.parseRawGrammar(await fs.readFile(filename, 'utf8'), filename);
    }
  });
  try {
    const modern = await registry.loadGrammar('source.typoscript');
    const legacy = await registry.loadGrammar('source.typoscript.v11');
    function tokenizeDocument(language, text, previous) {
        const grammar = language === 'typoscript-v11' ? legacy : modern;
        const lines = text.split(/\r\n|\r|\n/);
        const old = previous?.language === language ? previous.entries : [];
        const entries = [];
        let prefix = 0;
        let suffix = 0;
        while (prefix < Math.min(lines.length, old.length) && lines[prefix] === old[prefix].text) prefix++;
        while (suffix < Math.min(lines.length, old.length) - prefix
          && lines[lines.length - 1 - suffix] === old[old.length - 1 - suffix].text) suffix++;
        for (let index = 0; index < prefix; index++) entries.push(old[index]);
        let state = entries.at(-1)?.state || tm.INITIAL;
        let tokenizedLines = 0;
        for (let index = prefix; index < lines.length; index++) {
          const oldIndex = index - lines.length + old.length;
          if (index >= lines.length - suffix && old[oldIndex]?.before.equals(state)) {
            for (let rest = oldIndex; rest < old.length; rest++) entries.push(old[rest]);
            break;
          }
          const line = lines[index];
          const result = grammar.tokenizeLine(line, state);
          const before = state;
          state = result.ruleStack;
          const ranges = [];
          for (const token of result.tokens) {
            const category = categoryForScopes(token.scopes);
            const end = Math.min(token.endIndex, line.length);
            if (category && end > token.startIndex) {
              ranges.push({ category, start: token.startIndex, end });
            }
          }
          entries.push({ text: line, before, state, ranges });
          tokenizedLines++;
        }
        const ranges = entries.flatMap((entry, line) => entry.ranges.map((range) => ({ ...range, line })));
        return { language, entries, ranges, tokenizedLines };
    }
    return {
      tokenize(language, text) { return tokenizeDocument(language, text).ranges; },
      tokenizeDocument,
      dispose() { registry.dispose(); }
    };
  } catch (error) {
    registry.dispose();
    throw error;
  }
}

module.exports = { TOKEN_CATEGORIES, categoryForScopes, createTokenizer };
