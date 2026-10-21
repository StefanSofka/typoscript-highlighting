const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseSiteSettings } = require('../lib/site-settings');

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

test('aliases, custom tags, sequences, duplicate keys and imports are never resolved as scalar settings', () => {
  const text = 'original: &value hello\nalias: *value\nenv: !env SOME_SECRET\nitems: [one, two]\nimports:\n - resource: missing.yaml\n';
  const nodes = parseSiteSettings(text, '/settings.yaml');
  assert.deepEqual(nodes.map((node) => node.path), ['original']);
  assert.deepEqual(parseSiteSettings('site.title: First\nsite.title: Second', '/settings.yaml'), []);
});
