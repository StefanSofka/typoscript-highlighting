const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseSiteSettings, inspectSettings } = require('../lib/site-settings');

test('site settings read flat and nested scalar keys, quotes, comments and multiline values with source locations', () => {
  const nodes = parseSiteSettings('site.title: "Hello # World"\nsite:\n  color: red\nbroken: [unclosed\n', '/config/sites/main/settings.yaml');
  assert.equal(nodes.length, 0, 'invalid YAML must not produce misleading partial definitions');
  const valid = parseSiteSettings('site.title: "Hello # World"\nsite:\n  color: red\ncontact.email: |\n  hello@example.org\n', '/config/sites/main/settings.yaml');
  assert.deepEqual(valid.map((node) => node.path), ['site.title', 'site.color', 'contact.email']);
  assert.equal(valid[0].value.trim(), 'Hello # World'); assert.equal(valid[1].line, 2); assert.equal(valid[1].start, 2);
  assert.equal(valid[2].value.trim(), 'hello@example.org');
});

test('set definitions expose scalar defaults and documentation; site config exposes only settings', () => {
  const defaults = parseSiteSettings('categories:\n  main:\n    label: Main\nsettings:\n  site.title:\n    default: Hello\n    label: Website title\n    type: string\n', '/Configuration/Sets/Main/settings.definitions.yaml');
  assert.equal(defaults.length, 1); assert.equal(defaults[0].path, 'site.title'); assert.equal(defaults[0].origin, 'Site setting default'); assert.equal(defaults[0].description, 'Website title');
  const config = parseSiteSettings('base: https://example.org\nsettings:\n  contact.email: hello@example.org\n', '/config/sites/main/config.yaml');
  assert.deepEqual(config.map((node) => node.path), ['contact.email']);
});

test('bounded aliases and lists are readable; custom tags, duplicate keys and import keys are not settings', () => {
  const text = 'original: &value hello\nalias: *value\nenv: !env SOME_SECRET\nitems: [one, two]\nimports:\n - resource: missing.yaml\n';
  const nodes = parseSiteSettings(text, '/settings.yaml');
  assert.deepEqual(nodes.map((node) => node.path), ['original', 'alias', 'items']);
  assert.deepEqual(nodes[2].rawValue, ['one', 'two']);
  assert.deepEqual(parseSiteSettings('site.title: First\nsite.title: Second', '/settings.yaml'), []);
});

test('the YAML analysis limit measures UTF-8 bytes, including multibyte input', () => {
  const oversized = 'site.title: ' + '界'.repeat(180000);
  assert.ok(oversized.length < 512 * 1024);
  const model = inspectSettings(oversized, '/settings.yaml');
  assert.deepEqual(model.definitions, []);
  assert.ok(model.issues.some((issue) => issue.code === 'yaml-limit'));
  assert.equal(parseSiteSettings('site.title: 日本語', '/settings.yaml')[0].rawValue, '日本語');
});
