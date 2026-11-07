const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getSettings } = require('../lib/settings');

function setup(layers = {}, old = {}) {
  const writes = [];
  const vscode = { ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 }, workspace: {
    getConfiguration(section, uri) {
      assert.equal(section, 'typoscriptHighlighting');
      // Model the real API's snapshots so sequential updates cannot reuse stale data.
      const snapshot = JSON.parse(JSON.stringify(layers));
      return {
        inspect(key) { return key === 'customTheme' ? { defaultValue: {}, ...snapshot } : old[key]; },
        get(key, fallback) { return key === 'theme' ? 'nord' : fallback; },
        async update(key, value, target) {
          writes.push({ key, value, target, uri });
          if (key === 'customTheme') layers[{ 1: 'globalValue', 2: 'workspaceValue', 3: 'workspaceFolderValue' }[target]] = value;
        }
      };
    }
  } };
  return { settings: getSettings(vscode, 'folder-file'), writes, layers };
}

test('grouped colors preserve scope precedence, partial inheritance and an explicit empty color', () => {
  const { settings } = setup({
    globalValue: { colors: { comments: '#112233', values: '#223344' } },
    workspaceValue: { colors: { comments: '#334455' } },
    workspaceFolderValue: { colors: { comments: '' } }
  });
  assert.deepEqual(settings.inspect('colors.comments'), {
    defaultValue: '', globalValue: '#112233', workspaceValue: '#334455', workspaceFolderValue: ''
  });
  assert.equal(settings.get('colors.comments'), '');
  assert.equal(settings.get('colors.values'), '#223344');
  assert.deepEqual(settings.get('colors'), { comments: '', values: '#223344' });
  assert.equal(settings.inspect('colors.imports').defaultValue, '');
});

test('preserved legacy palettes merge per category and keep legacy version and skin semantics', () => {
  const { settings } = setup({
    globalValue: { legacy: { skin: 'editor', commentRules: 'v11', darkColors: { comments: '#112233', values: '#223344' } } },
    workspaceValue: { legacy: { darkColors: { comments: '' } } }
  });
  assert.equal(settings.get('skin'), 'editor');
  assert.equal(settings.get('commentRules'), 'v11');
  assert.deepEqual(settings.get('darkColors'), { comments: '', values: '#223344' });
  assert.deepEqual(settings.inspect('lightColors'), { defaultValue: {} });
});

test('unmigrated raw values remain a fallback and never override a narrower grouped value', () => {
  const { settings } = setup({
    globalValue: { colors: { comments: '#112233' } },
    workspaceFolderValue: { colors: { comments: '#334455' } }
  }, { 'colors.comments': { workspaceValue: '#223344', workspaceFolderValue: '#FFFFFF' } });
  assert.equal(settings.inspect('colors.comments').workspaceValue, '#223344');
  assert.equal(settings.get('colors.comments'), '#334455');
});

test('sequential updates preserve other colors, legacy values and scope boundaries', async () => {
  const { settings, layers, writes } = setup({
    globalValue: { colors: { values: '#112233' }, legacy: { skin: 'nord' } },
    workspaceFolderValue: { colors: { comments: '#445566' } }
  });
  await settings.update('colors.comments', '#223344', 1);
  await settings.update('colors.imports', '#334455', 1);
  assert.deepEqual(layers.globalValue, {
    colors: { values: '#112233', comments: '#223344', imports: '#334455' }, legacy: { skin: 'nord' }
  });
  assert.deepEqual(layers.workspaceFolderValue, { colors: { comments: '#445566' } });
  assert.ok(writes.every(({ key, target, uri }) => key === 'customTheme' && target === 1 && uri === 'folder-file'));
});

test('a palette save replaces that scope palette while preserving unrelated stored data', async () => {
  const { settings, layers } = setup({ workspaceValue: { colors: { values: '#112233' }, legacy: { commentRules: 'v12' } } });
  await settings.update('colors', { comments: '#223344' }, 2);
  assert.deepEqual(layers.workspaceValue, { colors: { comments: '#223344' }, legacy: { commentRules: 'v12' } });
  await settings.update('colors.comments', undefined, 2);
  assert.deepEqual(layers.workspaceValue, { legacy: { commentRules: 'v12' } });
  await settings.update('commentRules', undefined, 2);
  assert.equal(layers.workspaceValue, undefined);
});

test('modern settings still read and write their own registered keys', async () => {
  const { settings, writes } = setup();
  assert.equal(settings.get('theme'), 'nord');
  await settings.update('theme', 'light', 3);
  assert.deepEqual(writes, [{ key: 'theme', value: 'light', target: 3, uri: 'folder-file' }]);
});
