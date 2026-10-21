const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTokenizer } = require('../lib/tokenizer');

test('incremental tokenization reuses unchanged lines and shifts ranges after line insertion', async (t) => {
  const tokenizer = await createTokenizer();
  t.after(() => tokenizer.dispose());
  const text = Array.from({ length: 10000 }, (_, i) => `page.${i}.value = Example {$name}`).join('\n');
  const first = tokenizer.tokenizeDocument('typoscript-v12', text);
  const edited = text.replace('page.5.value = Example', 'page.5.value = New\npage.extra.value = Added');
  const second = tokenizer.tokenizeDocument('typoscript-v12', edited, first);
  assert.ok(second.tokenizedLines <= 3, `retokenized ${second.tokenizedLines} lines`);
  assert.deepEqual(second.ranges, tokenizer.tokenize('typoscript-v12', edited));
  assert.equal(tokenizer.tokenizeDocument('typoscript-v12', edited, second).tokenizedLines, 0);
});

test('incremental state propagates through comments and multiline values until convergence', async (t) => {
  const tokenizer = await createTokenizer();
  t.after(() => tokenizer.dispose());
  for (const [before, after] of [
    ['/* comment\npage = PAGE\n*/\npage.10 = TEXT', '/* comment */\npage = PAGE\n*/\npage.10 = TEXT'],
    ['value (\n# literal\n)\npage = PAGE', 'value = (\n# literal\n)\npage = PAGE']
  ]) {
    const first = tokenizer.tokenizeDocument('typoscript-v12', before);
    assert.deepEqual(tokenizer.tokenizeDocument('typoscript-v12', after, first).ranges,
      tokenizer.tokenize('typoscript-v12', after));
  }
});
