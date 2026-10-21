const { test } = require('node:test');
const assert = require('node:assert/strict');
const { describeVersion, SHARED_LANGUAGE } = require('../lib/editor');
const { targetVersion } = require('../lib/language');

test('version descriptions distinguish installed versions, ranges, manual choices and unknown fallback', () => {
  assert.match(describeVersion({ source: 'lock', version: '13.4.0', sourceUri: { path: '/site/composer.lock' } }).text, /13.4.0/);
  const range = describeVersion({ source: 'manifest', major: 13, constraint: '^13.4 || ^14', sourceUri: { path: '/site/composer.json' } });
  assert.match(range.detail, /not an installed version/);
  assert.match(describeVersion().text, /Fallback/);
  assert.match(describeVersion({ source: 'manual', major: 11, languageId: 'typoscript-v11' }).text, /Pinned/);
  assert.equal(SHARED_LANGUAGE, '[typoscript][typoscript-v11][typoscript-v12]');
});

test('explicit new Auto setting can replace legacy forced comment rules', () => {
  const config = { get: (key) => key === 'typo3Version' ? 'auto' : 'v11', inspect: () => ({ globalValue: 'auto' }) };
  assert.equal(targetVersion(config), 'auto');
  assert.equal(targetVersion({ ...config, inspect: () => ({ defaultValue: 'auto' }) }), 'v11');
});

test('shared settings command copies generic options into the combined language override', async () => {
  const { createEditorTools } = require('../lib/editor');
  const commands = new Map(), writes = [];
  const disposable = { dispose() {} };
  const generic = { 'editor.tabSize': 7, 'editor.defaultFormatter': 'example.formatter' };
  const vscode = {
    StatusBarAlignment: { Right: 2 }, ConfigurationTarget: { Global: 1 },
    commands: { registerCommand: (key, callback) => { commands.set(key, callback); return disposable; } },
    window: { createStatusBarItem: () => ({ hide() {}, dispose() {} }), onDidChangeActiveTextEditor: () => disposable,
      showQuickPick: async (choices) => choices[0], showInformationMessage: async () => undefined },
    workspace: { workspaceFolders: [],
      getConfiguration: () => ({ inspect: (key) => ({ globalValue: key === '[typoscript]' ? generic : { 'editor.wordWrap': 'on' } }),
        update: async (...args) => writes.push(args) }) }
  };
  const tools = createEditorTools(vscode, { onDidResolve: () => disposable }, assert.fail);
  await commands.get('typoscriptHighlighting.configureLanguageSettings')();
  assert.deepEqual(writes, [[SHARED_LANGUAGE, { 'editor.wordWrap': 'on', ...generic }, 1]]);
  tools.dispose();
});
