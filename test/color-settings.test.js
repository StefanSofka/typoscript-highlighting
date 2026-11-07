const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createColorSettings, getColors, COMMAND, EDIT_COMMAND, CATEGORIES } = require('../lib/color-settings');
const { Uri } = require('./helpers/editor');

function signal() {
  const listeners = new Set();
  return { subscribe(callback) { listeners.add(callback); return { dispose() { listeners.delete(callback); } }; },
    fire(value) { for (const callback of [...listeners]) callback(value); }, get size() { return listeners.size; } };
}

function setup(t, active = false) {
  const configuration = signal(), editors = signal();
  const commands = new Map(), panels = [], writes = [], errors = [], values = new Map(), calls = [];
  let updateHook;
  const folder = { name: 'Site', uri: Uri.file('/site') };
  const config = (uri) => ({
    inspect(key) {
      return { defaultValue: ['skin', 'theme'].includes(key) ? 'auto' : key.endsWith('Colors') || key === 'customTheme' ? {} : '', globalValue: values.get(`1:${key}`),
        workspaceValue: values.get(`2:${key}`), workspaceFolderValue: values.get(`3:${uri?.toString()}:${key}`) };
    },
    get(key, fallback) {
      const layers = this.inspect(key);
      const values = [layers.defaultValue, layers.globalValue, layers.workspaceValue, layers.workspaceFolderValue].filter((value) => value !== undefined);
      return key.endsWith('Colors') ? Object.assign({}, ...values) : values.at(-1) ?? fallback;
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
    commands: { async executeCommand(...args) { calls.push(args); }, registerCommand(id, callback) { commands.set(id, callback); return { dispose() { commands.delete(id); } }; } },
    workspace: { workspaceFolders: [folder], getWorkspaceFolder(uri) { return uri.path.startsWith('/site/') ? folder : undefined; },
      getConfiguration: (_section, uri) => config(uri), onDidChangeConfiguration: configuration.subscribe },
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
  const open = (category) => { commands.get(EDIT_COMMAND)(category); panels.at(-1).received.fire({ type: 'ready' }); return panels.at(-1); };
  return { vscode, picker, commands, panels, writes, values, errors, open, configuration, editors, calls,
    hook(callback) { updateHook = callback; } };
}

const draft = () => Object.fromEntries(CATEGORIES.map(([category], index) => [category, `#AABB0${index}`]));
const save = (panel, colors = draft(), id = 1) => panel.received.fire({ type: 'save', colors, id });

test('Theme Settings opens the visual editor directly without opening native Settings', async (t) => {
  const { commands, calls, panels, writes } = setup(t);
  await commands.get(COMMAND)();
  assert.deepEqual(calls, []);
  assert.equal(panels.length, 1);
  assert.ok(panels[0].webview.html.includes('id="theme"'));
  assert.equal(writes.length, 0);
});

test('the extension menu context cannot be mistaken for a color category', async (t) => {
  const { commands, panels } = setup(t);
  await commands.get(COMMAND)({ identifier: { id: 'stefan-sofka.typoscript-highlighting' } });
  panels[0].received.fire({ type: 'ready' });
  assert.equal(panels[0].messages.at(-1).category, undefined);
});

test('custom editor opens nine colors without writing settings and reuses its panel', (t) => {
  const { open, writes, panels } = setup(t);
  const panel = open('values');
  assert.equal(panel.messages.at(-1).colors.length, 9);
  assert.equal(panel.messages.at(-1).location, 'User settings');
  assert.equal(panel.messages.at(-1).category, 'values');
  assert.ok(panel.messages.at(-1).colors.every(({ color }) => /^#[0-9A-F]{6}$/.test(color)));
  assert.ok(panel.webview.html.includes("default-src 'none'"));
  assert.ok(panel.webview.html.includes('id="save"'));
  assert.ok(panel.webview.html.includes('id="theme"'));
  assert.deepEqual(panel.messages.at(-1).themes.map(({ id }) => id), ['auto', 'dark', 'light', 'nord', 'monokai', 'solarized', 'custom']);
  for (const id of ['scope', 'palette', 'skin', 'inherit-all', 'undo', 'spectrum']) assert.ok(!panel.webview.html.includes(`id="${id}"`));
  open('comments');
  assert.equal(panels.length, 1);
  assert.equal(panel.messages.at(-1).category, 'comments');
  assert.equal(writes.length, 0);
});

test('saving a complete custom theme writes one palette, then selects Custom', async (t) => {
  const { open, picker, writes, values } = setup(t);
  const panel = open();
  save(panel, Object.fromEntries(Object.entries(draft()).map(([key, value]) => [key, value.toLowerCase()])));
  await picker.whenIdle();
  assert.equal(writes.length, 2);
  assert.ok(writes.every(({ target }) => target === 1));
  assert.deepEqual(writes.at(-1), { key: 'theme', value: 'custom', target: 1, uri: undefined });
  assert.deepEqual(values.get('1:customTheme'), { colors: draft() });
  assert.ok(panel.messages.some(({ type }) => type === 'saved'));
});

test('saved custom colors remain available when another preset is selected', (t) => {
  const { values, open } = setup(t);
  values.set('1:theme', 'nord');
  values.set('1:colors.comments', '#123456');
  const panel = open();
  assert.equal(panel.messages.at(-1).colors.find(({ category }) => category === 'comments').color, '#123456');
  assert.equal(panel.messages.at(-1).colors.find(({ category }) => category === 'values').color, '#EBCB8B');
  assert.equal(panel.messages.at(-1).themes.find(({ id }) => id === 'nord').colors.comments, '#A3BE8C');
});

test('the dropdown applies all five presets by changing only Theme and retaining custom colors', async (t) => {
  const { values, open, picker, writes } = setup(t);
  values.set('1:colors.comments', '#123456');
  const panel = open();
  for (const [index, theme] of ['dark', 'light', 'nord', 'monokai', 'solarized'].entries()) {
    panel.received.fire({ type: 'theme', theme, id: index + 1 });
    await picker.whenIdle();
    assert.equal(values.get('1:theme'), theme);
    assert.equal(panel.messages.at(-1).theme, theme);
  }
  assert.equal(writes.length, 5);
  assert.ok(writes.every(({ key }) => key === 'theme'));
  assert.equal(values.get('1:colors.comments'), '#123456');
});

test('invalid dropdown choices cannot change settings and a failed choice reports the previous theme', async (t) => {
  const { values, open, picker, writes, hook } = setup(t);
  values.set('1:theme', 'nord');
  const panel = open();
  for (const theme of ['unknown', 'constructor', 'custom', null]) panel.received.fire({ type: 'theme', theme, id: 1 });
  panel.received.fire({ type: 'theme', theme: 'dark', id: '1' });
  await picker.whenIdle();
  assert.equal(writes.length, 0);
  hook(async () => { throw new Error('Read only'); });
  panel.received.fire({ type: 'theme', theme: 'dark', id: 2 });
  await picker.whenIdle();
  assert.ok(panel.messages.some(({ type, operation }) => type === 'error' && operation === 'theme'));
  assert.equal(panel.messages.at(-1).theme, 'nord');
});

test('a preset requested after a pending custom save is applied last', async (t) => {
  const { open, picker, values, hook } = setup(t);
  const panel = open();
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  let first = true;
  hook(async () => { if (first) { first = false; await blocked; } });
  save(panel);
  await Promise.resolve();
  panel.received.fire({ type: 'theme', theme: 'monokai', id: 2 });
  release(); await picker.whenIdle();
  assert.equal(values.get('1:theme'), 'monokai');
  assert.equal(values.get('1:customTheme').colors.comments, draft().comments);
});

test('an existing project theme is edited in that project without touching personal colors', async (t) => {
  const { values, open, picker, writes } = setup(t, true);
  values.set('3:file:///site/setup.typoscript:theme', 'nord');
  values.set('1:colors.comments', '#112233');
  const panel = open();
  assert.equal(panel.messages.at(-1).location, 'Project: Site');
  save(panel);
  await picker.whenIdle();
  assert.ok(writes.every(({ target, uri }) => target === 3 && uri.path === '/site/setup.typoscript'));
  assert.equal(values.get('1:colors.comments'), '#112233');
});

test('migrated project palettes keep theme edits at their original project scope', async (t) => {
  for (const key of ['darkColors', 'lightColors', 'customColors']) {
    const { values, open, picker, writes } = setup(t, true);
    const legacy = { [key]: { comments: '#123456' } };
    values.set('3:file:///site/setup.typoscript:customTheme', { legacy });
    const panel = open();
    assert.equal(panel.messages.at(-1).location, 'Project: Site', key);
    assert.equal(writes.length, 0);
    save(panel);
    await picker.whenIdle();
    assert.ok(writes.every(({ target }) => target === 3), key);
    assert.deepEqual(values.get('3:file:///site/setup.typoscript:customTheme'), { legacy, colors: draft() });
  }
});

test('workspace palettes and unmigrated folder colors retain their save destination', async (t) => {
  const workspace = setup(t, true);
  workspace.values.set('2:customTheme', { colors: { comments: '#123456' } });
  const workspacePanel = workspace.open();
  assert.equal(workspacePanel.messages.at(-1).location, 'Workspace settings');
  save(workspacePanel);
  await workspace.picker.whenIdle();
  assert.ok(workspace.writes.every(({ target }) => target === 2));

  const folder = setup(t, true);
  folder.values.set('3:file:///site/setup.typoscript:colors.comments', '#123456');
  const folderPanel = folder.open();
  assert.equal(folderPanel.messages.at(-1).location, 'Project: Site');
  save(folderPanel);
  await folder.picker.whenIdle();
  assert.ok(folder.writes.every(({ target }) => target === 3));
});

test('invalid, partial or unknown color messages cannot change settings', async (t) => {
  const { open, picker, writes } = setup(t);
  const panel = open();
  for (const message of [null, {}, { type: 'save', colors: draft(), id: '1' },
    { type: 'save', colors: { comments: '#123456' }, id: 1 },
    { type: 'save', colors: { ...draft(), comments: '#ABC' }, id: 1 },
    { type: 'save', colors: { ...draft(), values: null }, id: 1 },
    { type: 'save', colors: { ...draft(), constructor: '#123456' }, id: 1 },
    { type: 'color', category: 'comments', color: '#123456', id: 1 }]) panel.received.fire(message);
  await picker.whenIdle();
  assert.equal(writes.length, 0);
});

test('save failures are reported, keep the preset selected, and permit retry', async (t) => {
  const { open, picker, hook, errors, values } = setup(t);
  values.set('1:theme', 'nord');
  const panel = open();
  hook(async () => { throw new Error('Read only'); });
  save(panel);
  await picker.whenIdle();
  assert.equal(errors.length, 1);
  assert.equal(values.get('1:theme'), 'nord');
  assert.ok(panel.messages.some(({ type }) => type === 'error'));
  hook(undefined); save(panel, draft(), 2);
  await picker.whenIdle();
  assert.equal(values.get('1:theme'), 'custom');
});

test('closing the editor consumes late posts while the requested save finishes', async (t) => {
  const { open, picker, writes } = setup(t);
  const panel = open();
  save(panel); panel.dispose();
  const count = panel.messages.length;
  await picker.whenIdle();
  assert.equal(writes.length, 2);
  assert.equal(panel.messages.length, count);
  assert.equal(panel.received.size, 0);
});

test('external configuration refreshes the custom editor and disposal releases listeners', async (t) => {
  const { open, values, configuration, picker, commands } = setup(t);
  const panel = open();
  values.set('1:colors.comments', '#123456');
  configuration.fire({ affectsConfiguration: () => true });
  assert.equal(panel.messages.at(-1).colors[0].color, '#123456');
  panel.webview.postMessage = async () => { throw new Error('Unknown webview handle:closed'); };
  configuration.fire({ affectsConfiguration: () => true });
  await picker.whenIdle();
  picker.dispose();
  assert.equal(commands.size, 0);
  assert.equal(configuration.size, 0);
});
