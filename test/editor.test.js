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
  const core = { source: 'core', version: '13.4.0', major: 13, installation: 'classic', sourceUri: { path: '/site/typo3/sysext/core/Classes/Information/Typo3Version.php' }, conflict: { version: '14.3.0', sourceUri: { path: '/site/composer.lock' } } };
  assert.match(describeVersion(core).text, /Classic/); assert.match(describeVersion(core).text, /warning/);
  assert.match(describeVersion(core).detail, /installed core takes precedence/);
  assert.match(describeVersion({ ...core, source: 'lock' }).detail, /an installed core was not found/);
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

test('detection menu exposes sources and version conflicts before optional overrides and Auto removes a language pin', async () => {
  const { createEditorTools } = require('../lib/editor');
  const commands = new Map(), writes = [], menus = [];
  const disposable = { dispose() {} };
  const document = { uri: { toString: () => 'file:///site/setup.typoscript' }, languageId: 'typoscript-v11' };
  const info = { source: 'core', major: 13, version: '13.4.0', installation: 'composer', root: { path: '/site' },
    sourceUri: { path: '/site/vendor/typo3/cms-core/Classes/Information/Typo3Version.php' }, conflict: { version: '14.3.0', sourceUri: { path: '/site/composer.lock' } } };
  let chooseAuto = false;
  const vscode = {
    StatusBarAlignment: { Right: 2 }, ConfigurationTarget: { Global: 1 },
    commands: { registerCommand: (key, callback) => { commands.set(key, callback); return disposable; } },
    window: { activeTextEditor: { document }, createStatusBarItem: () => ({ show() {}, hide() {}, dispose() {} }), onDidChangeActiveTextEditor: () => disposable,
      showQuickPick: async (options, settings) => { menus.push({ options, settings }); return chooseAuto ? options.find((item) => item.version === 'auto') : undefined; } },
    workspace: { textDocuments: [document], getWorkspaceFolder: () => undefined,
      getConfiguration: () => ({ update: async (...args) => writes.push(args) }) },
    languages: { setTextDocumentLanguage: async (_document, languageId) => { document.languageId = languageId; } }
  };
  const tools = createEditorTools(vscode, { getInfo: () => info, onDidResolve: () => disposable, whenIdle: async () => {}, refresh: async () => {} }, assert.fail);
  await commands.get('typoscriptHighlighting.showVersion')();
  assert.ok(!menus[0].settings.title.includes('$('));
  assert.equal(menus[0].options[0].detail, 'vendor/typo3/cms-core/Classes/Information/Typo3Version.php');
  assert.match(menus[0].options[1].label, /13\.4\.0 installed, 14\.3\.0 locked/);
  assert.ok(!menus[0].options.some((option) => /^v\d/.test(option.version || '')));
  chooseAuto = true; await commands.get('typoscriptHighlighting.showVersion')();
  assert.deepEqual(writes, [['typo3Version', 'auto', 1]]); assert.equal(document.languageId, 'typoscript');
  tools.dispose();
});
