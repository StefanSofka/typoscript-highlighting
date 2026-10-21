const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parse } = require('../lib/parser');
const { suggestions, migrationHints } = require('../lib/catalog');
const complete = (text, info = {}) => { const lines = text.split('\n'); return suggestions(parse(text), { line: lines.length - 1, character: lines.at(-1).length }, info); };

test('cObject completion follows exact versions and leaves unknown versions conservative', () => {
  assert.ok(!complete('page.10 = PA', { source: 'core', major: 12, version: '12.4.0' }).some((item) => item.label === 'PAGEVIEW'));
  assert.ok(!complete('page.10 = PA', { source: 'core', major: 13, version: '13.0.1' }).some((item) => item.label === 'PAGEVIEW'));
  assert.ok(complete('page.10 = PA', { source: 'core', major: 13, version: '13.1.0' }).some((item) => item.label === 'PAGEVIEW'));
  assert.ok(complete('page.10 = FLU').some((item) => item.label === 'FLUIDTEMPLATE'));
});

test('properties complete within typed object blocks, dotted paths, config and stdWrap', () => {
  assert.ok(complete('page.10 = TEXT\npage.10.va').some((item) => item.label === 'value' && item.start === 8));
  assert.ok(complete('page.10 = FLUIDTEMPLATE\npage.10 {\n  templateR').some((item) => item.label === 'templateRootPaths'));
  assert.ok(complete('config {\n  abs').some((item) => item.label === 'absRefPrefix'));
  assert.ok(complete('page.10.stdWrap.ht').some((item) => item.label === 'htmlSpecialChars'));
  assert.deepEqual(complete('page.10 = CUSTOM\npage.10.va'), []);
  assert.deepEqual(complete('# page.10 = FLU'), []);
  assert.deepEqual(complete('literal (\npage.10 = FLU'), []);
});

test('migration hints are advisory, source-aware and do not infer exact versions from ranges', () => {
  const parsed = parse('page.10 = TEMPLATE\npage.20 = PAGEVIEW\npage.30 = CUSTOM');
  assert.deepEqual(migrationHints(parsed, { source: 'core', major: 12, version: '12.4.0' }).map((item) => item.code), ['removed-template', 'unavailable-pageview']);
  assert.deepEqual(migrationHints(parsed, { source: 'core', major: 14, version: '14.3.0' }).map((item) => item.code), ['removed-template']);
  assert.deepEqual(migrationHints(parsed, { source: 'manifest', major: 12, constraint: '^12 || ^14' }), []);
});
