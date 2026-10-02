const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createColorSettings, getColors, COMMAND, CATEGORIES } = require('../lib/color-settings');
const { TOKEN_CATEGORIES } = require('../lib/tokenizer');
const { Uri } = require('./helpers/editor');

function signal() {
  const listeners = new Set();
  return { subscribe(callback) { listeners.add(callback); return { dispose() { listeners.delete(callback); } }; },
    fire(value) { for (const callback of [...listeners]) callback(value); }, get size() { return listeners.size; } };
}

function setup(t, active = false) {
  const configuration = signal(), folders = signal(), editors = signal();
  const commands = new Map(), panels = [], writes = [], errors = [], values = new Map();
  let updateHook;
  const folder = { name: 'Site', uri: Uri.file('/site') };
  const config = (uri) => ({
    inspect(key) {
      return { defaultValue: key === 'customColors' ? {} : '', globalValue: values.get(`1:${key}`),
        workspaceValue: values.get(`2:${key}`), workspaceFolderValue: values.get(`3:${uri?.toString()}:${key}`) };
    },
    async update(key, value, target) {
      if (updateHook) await updateHook(key, value, target);
      writes.push({ key, value, target, uri });
      values.set(`${target}:${target === 3 ? `${uri.toString()}:` : ''}${key}`, value);
      configuration.fire({ affectsConfiguration: (section) => section === 'typoscriptHighlighting.colors' });
    }
  });
  const vscode = {
    Uri, ViewColumn: { One: 1, Beside: -2 }, ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    commands: { registerCommand(id, callback) { commands.set(id, callback); return { dispose() { commands.delete(id); } }; } },
    workspace: { workspaceFolders: [folder], getWorkspaceFolder(uri) { return uri.path.startsWith('/site/') ? folder : undefined; },
      getConfiguration: (_section, uri) => config(uri), onDidChangeConfiguration: configuration.subscribe,
      onDidChangeWorkspaceFolders: folders.subscribe },
    window: { activeTextEditor: active ? { document: { uri: Uri.file('/site/setup.typoscript'), languageId: 'typoscript-v12' } } : undefined,
      onDidChangeActiveTextEditor: editors.subscribe,
      createWebviewPanel(type, title, column, options) {
        const messages = [], received = signal(), closed = signal();
        const panel = { type, title, column, viewColumn: column, options, messages, received, closed,
          reveals: [], reveal(column) { this.reveals.push(column); },
          dispose() { if (!this.disposed) { this.disposed = true; closed.fire(); } },
          onDidDispose: closed.subscribe,
          webview: { cspSource: 'vscode-webview://test', asWebviewUri: (uri) => uri.toString(),
            onDidReceiveMessage: received.subscribe, postMessage: async (message) => { messages.push(message); return true; } } };
        panels.push(panel);
        return panel;
      } }
  };
  const picker = createColorSettings(vscode, Uri.file('/extension'), (error) => errors.push(error));
  t.after(() => picker.dispose());
  const open = (category) => { commands.get(COMMAND)(category); panels.at(-1).received.fire({ type: 'ready' }); return panels.at(-1); };
  const color = (panel, category, value, id = 1) => panel.received.fire({ type: 'color', category, color: value, id });
  return { vscode, picker, commands, panels, writes, values, errors, open, color, configuration, folders, editors,
    hook(callback) { updateHook = callback; } };
}

test('picker reads each scope with inheritance, legacy compatibility and explicit theme reset', (t) => {
  const { vscode, values } = setup(t);
  assert.deepEqual(CATEGORIES.map(([category]) => category), Object.keys(TOKEN_CATEGORIES));
  values.set('1:colors.comments', '#abcdef');
  values.set('2:colors.comments', '#123456');
  values.set('3:file:///site:colors.comments', '');
  values.set('1:colors.values', 'custom');
  values.set('1:customColors', { values: '#abcdef' });
  values.set('2:customColors', { comments: '#000000' });
  const read = (id) => Object.fromEntries(getColors(vscode, { id, uri: Uri.file('/site') }).map((entry) => [entry.category, entry.color]));
  assert.equal(read('user').comments, '#ABCDEF');
  assert.equal(read('workspace').comments, '#123456');
  assert.equal(read('folder:file:///site').comments, '');
  assert.equal(read('folder:file:///site').values, '#ABCDEF');
  values.set('3:file:///site:colors.values', '#654321');
  assert.equal(read('folder:file:///site').values, '#654321');
});

test('command opens a local spectrum view without saving settings and reuses the panel', (t) => {
  const { open, panels, writes } = setup(t);
  const panel = open('values');
  assert.equal(panel.messages.at(-1).colors.length, 9);
  assert.equal(panel.messages.at(-1).category, 'values');
  assert.equal(panel.messages.at(-1).targetId, 'user');
  assert.ok(panel.messages.at(-1).colors.every((entry) => entry.color === ''));
  assert.deepEqual(panel.options.localResourceRoots.map((uri) => uri.path), ['/extension/media']);
  assert.ok(panel.webview.html.includes("default-src 'none'"));
  assert.ok(panel.webview.html.includes('color-settings.js'));
  assert.ok(panel.webview.html.includes('id="spectrum"'));
  open('comments');
  assert.equal(panels.length, 1);
  assert.equal(panel.messages.at(-1).category, 'comments');
  assert.equal(writes.length, 0);
});

test('picker follows the active project and serializes writes across captured scopes', async (t) => {
  const { open, color, picker, writes, hook } = setup(t, true);
  const panel = open();
  assert.equal(panel.messages.at(-1).targetId, 'folder:file:///site');
  let release;
  let calls = 0;
  const blocked = new Promise((resolve) => { release = resolve; });
  hook(async () => { calls++; if (calls === 1) await blocked; });
  color(panel, 'comments', '#abcdef');
  await Promise.resolve();
  color(panel, 'values', '#123456', 2);
  panel.received.fire({ type: 'target', targetId: 'user' });
  color(panel, 'operators', '#654321', 3);
  assert.equal(calls, 1, 'only one settings write may run at a time');
  release();
  await picker.whenIdle();
  assert.deepEqual(writes.map(({ key, value, target }) => [key, value, target]), [
    ['colors.comments', '#ABCDEF', 3], ['colors.values', '#123456', 3], ['colors.operators', '#654321', 1]
  ]);
  assert.ok(writes.slice(0, 2).every(({ uri }) => uri.path === '/site'));
  assert.equal(writes[2].uri, undefined);
});

test('System Default saves an explicit empty value to mask inherited overrides', async (t) => {
  const { open, color, picker, values, writes } = setup(t, true);
  values.set('1:colors.comments', '#FF0000');
  const panel = open();
  assert.equal(panel.messages.at(-1).colors[0].color, '#FF0000');
  color(panel, 'comments', '');
  await picker.whenIdle();
  assert.equal(writes[0].value, '');
  assert.equal(panel.messages.at(-1).colors[0].color, '');
});

test('invalid messages and unknown targets cannot write configuration', async (t) => {
  const { open, picker, writes } = setup(t);
  const panel = open();
  for (const message of [null, {}, { type: 'color', category: 'comments', color: '#123', id: 1 },
    { type: 'color', category: 'constructor', color: '#123456', id: 1 },
    { type: 'color', category: 'comments', color: null, id: 1 },
    { type: 'color', category: 'comments', color: '#123456', id: '1' },
    { type: 'target', targetId: 'folder:file:///unrelated' }]) panel.received.fire(message);
  await picker.whenIdle();
  assert.equal(writes.length, 0);
  assert.equal(panel.messages.at(-1).targetId, 'user');
});

test('external edits and removed folders refresh the view; closing releases listeners', (t) => {
  const { open, values, configuration, folders, vscode, commands, picker } = setup(t, true);
  const panel = open();
  values.set('3:file:///site:colors.comments', '#123456');
  configuration.fire({ affectsConfiguration: () => true });
  assert.equal(panel.messages.at(-1).colors[0].color, '#123456');
  vscode.workspace.workspaceFolders = [];
  folders.fire();
  assert.equal(panel.messages.at(-1).targetId, 'user');
  panel.dispose();
  assert.equal(panel.received.size, 0);
  open();
  picker.dispose();
  assert.equal(commands.size, 0);
  assert.equal(configuration.size, 0);
  assert.equal(folders.size, 0);
});

test('save failures are reported and later writes still complete after a panel closes', async (t) => {
  const { open, color, picker, errors, writes, hook } = setup(t);
  const panel = open();
  let failed = false;
  hook(async () => { if (!failed) { failed = true; throw new Error('Read only'); } });
  color(panel, 'comments', '#123456');
  await picker.whenIdle();
  assert.equal(errors.length, 1);
  assert.ok(panel.messages.some((message) => message.type === 'error'));
  color(panel, 'comments', '#654321', 2);
  panel.dispose();
  const count = panel.messages.length;
  await picker.whenIdle();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].value, '#654321');
  assert.equal(panel.messages.length, count);
});
