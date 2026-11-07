const { test } = require('node:test');
const assert = require('node:assert/strict');
const { migrateSettings } = require('../lib/settings-migration');
const { Uri } = require('./helpers/editor');

const SECTION = 'typoscriptHighlighting.';
const CATEGORIES = ['comments', 'objectPaths', 'values', 'operators', 'constants', 'conditions', 'imports', 'functions', 'punctuation'];

function setup(folders = ['/first', '/second']) {
  const global = {}, workspace = {}, files = new Map(), writes = [], reads = [], errors = [], inspected = [];
  let writeHook, readHook;
  const vscode = {
    Uri, ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    workspace: {
      workspaceFile: folders.length ? Uri.file('/current.code-workspace') : undefined,
      workspaceFolders: folders.map((path) => ({ uri: Uri.file(path), name: path.slice(1) })),
      fs: { async readFile(uri) {
        reads.push(uri.toString());
        if (readHook) await readHook(uri);
        if (!files.has(uri.toString())) throw Object.assign(new Error('Not found'), { code: 'FileNotFound' });
        return Buffer.from(files.get(uri.toString()));
      } },
      getConfiguration(section, uri) {
        assert.equal(section, 'typoscriptHighlighting');
        return {
          inspect(key) {
            inspected.push({ key, uri });
            // Unknown old settings have no reliable folder inspection after
            // deregistration. Deliberately omit that value in this mock.
            return { defaultValue: key === 'customTheme' ? {} : key === 'skin' ? 'auto' : undefined,
              globalValue: global[key], workspaceValue: workspace[key] };
          },
          async update(key, value, target) {
            const write = { key, value, target, uri };
            writes.push(write);
            if (writeHook) await writeHook(write);
            if (target === 3) {
              const filename = Uri.joinPath(uri, '.vscode', 'settings.json').toString();
              const { parse } = require('jsonc-parser');
              const settings = parse(files.get(filename), [], { allowTrailingComma: true });
              if (value === undefined) delete settings[SECTION + key];
              else settings[SECTION + key] = value;
              files.set(filename, JSON.stringify(settings));
            } else {
              const values = target === 1 ? global : workspace;
              if (value === undefined) delete values[key];
              else values[key] = value;
            }
          }
        };
      }
    }
  };
  return { vscode, global, workspace, files, writes, reads, errors, inspected,
    run: () => migrateSettings(vscode, (error) => errors.push(error)),
    put(folder, text) { files.set(Uri.joinPath(Uri.file(folder), '.vscode', 'settings.json').toString(), typeof text === 'string' ? text : JSON.stringify(text)); },
    folder(folder) { return JSON.parse(files.get(Uri.joinPath(Uri.file(folder), '.vscode', 'settings.json').toString())); },
    writeHook(callback) { writeHook = callback; }, readHook(callback) { readHook = callback; } };
}

test('all fourteen old settings move to Custom Theme before cleanup without selecting a theme', async () => {
  const app = setup([]);
  const colors = Object.fromEntries(CATEGORIES.map((key, index) => [key, index ? `#AABB0${index}` : '']));
  for (const [category, value] of Object.entries(colors)) app.global[`colors.${category}`] = value;
  const legacy = { skin: 'nord', darkColors: { comments: '#123456' }, lightColors: { values: '' },
    customColors: { constants: '#ABCDEF' }, commentRules: 'v11' };
  Object.assign(app.global, legacy, { theme: 'monokai', unrelated: true });
  await app.run();
  assert.deepEqual(app.global, { customTheme: { colors, legacy }, theme: 'monokai', unrelated: true });
  assert.equal(app.writes.length, 15);
  assert.equal(app.writes[0].key, 'customTheme');
  assert.ok(app.writes.slice(1).every(({ value, target }) => value === undefined && target === 1));
  assert.deepEqual(app.errors, []);
  const count = app.writes.length;
  await app.run();
  assert.equal(app.writes.length, count);
});

test('new members win while palettes merge by category and unknown data is retained', async () => {
  const app = setup([]);
  const current = { future: { setting: true }, colors: { comments: '#ABCDEF', futureColor: '#654321' },
    legacy: { skin: 'solarized', future: ['keep'], darkColors: { comments: '#111111' },
      lightColors: { values: '' }, customColors: { constants: '#222222' } } };
  const original = JSON.parse(JSON.stringify(current));
  app.global.customTheme = current;
  Object.assign(app.global, { 'colors.comments': '#000000', 'colors.values': '#555555', skin: 'nord',
    darkColors: { comments: '#999999', values: '#888888' }, lightColors: { values: '#777777', imports: '#666666' },
    customColors: { constants: '#333333', functions: '#444444' }, commentRules: 'v11' });
  await app.run();
  assert.deepEqual(app.global.customTheme, { future: { setting: true }, colors: { comments: '#ABCDEF', futureColor: '#654321', values: '#555555' },
    legacy: { skin: 'solarized', future: ['keep'], darkColors: { comments: '#111111', values: '#888888' },
      lightColors: { values: '', imports: '#666666' }, customColors: { constants: '#222222', functions: '#444444' }, commentRules: 'v11' } });
  assert.deepEqual(current, original, 'inspection data must not be mutated');
  assert.deepEqual(app.errors, []);
});

test('user, workspace and each opened folder migrate independently, reading folder JSONC directly', async () => {
  const app = setup();
  app.global['colors.comments'] = '#111111';
  app.workspace['colors.comments'] = '#222222';
  app.workspace.skin = 'light';
  app.put('/first', `\uFEFF{ // A folder override unavailable through inspect
    "typoscriptHighlighting.colors.comments": "#333333",
    "typoscriptHighlighting.customTheme": {"colors": {"values": "#AAAAAA"}},
    "editor.tabSize": 4,
  }`);
  app.put('/second', { [SECTION + 'colors.comments']: '#444444', [SECTION + 'skin']: 'dark' });
  await app.run();
  assert.deepEqual(app.global.customTheme, { colors: { comments: '#111111' } });
  assert.deepEqual(app.workspace.customTheme, { colors: { comments: '#222222' }, legacy: { skin: 'light' } });
  assert.deepEqual(app.folder('/first'), { [SECTION + 'customTheme']: { colors: { comments: '#333333', values: '#AAAAAA' } }, 'editor.tabSize': 4 });
  assert.deepEqual(app.folder('/second'), { [SECTION + 'customTheme']: { colors: { comments: '#444444' }, legacy: { skin: 'dark' } } });
  assert.ok(app.inspected.every(({ uri }) => uri === undefined), 'folder values must come from JSONC rather than unknown-setting inspection');
  assert.deepEqual(app.reads, ['file:///first/.vscode/settings.json', 'file:///second/.vscode/settings.json']);
  assert.deepEqual(app.writes.filter(({ key }) => key === 'customTheme').map(({ target, uri }) => [target, uri?.path]),
    [[1, undefined], [2, undefined], [3, '/first'], [3, '/second']]);
  assert.deepEqual(app.errors, []);
});

test('defaults, absent folder files and empty JSONC never create overrides', async () => {
  const app = setup();
  app.put('/first', '// No custom settings yet\n');
  await app.run();
  assert.deepEqual(app.writes, []);
  assert.deepEqual(app.global, {});
  assert.deepEqual(app.workspace, {});
  assert.deepEqual(app.errors, []);
});

test('invalid folder JSONC and non-object roots are untouched while other scopes continue', async () => {
  for (const source of ['{"typoscriptHighlighting.colors.comments":"#111111",', '[]', 'null']) {
    const app = setup();
    app.put('/first', source);
    app.put('/second', { [SECTION + 'colors.values']: '#222222' });
    app.global.skin = 'nord';
    await app.run();
    assert.equal(app.files.get('file:///first/.vscode/settings.json'), source);
    assert.ok(!app.writes.some(({ uri }) => uri?.path === '/first'));
    assert.deepEqual(app.global.customTheme, { legacy: { skin: 'nord' } });
    assert.deepEqual(app.folder('/second'), { [SECTION + 'customTheme']: { colors: { values: '#222222' } } });
    assert.equal(app.errors.length, 1);
    assert.match(app.errors[0].message, /Folder first.*Invalid settings JSONC/);
  }
});

test('unreadable folder settings are reported without touching that scope', async () => {
  const app = setup();
  app.put('/first', { [SECTION + 'skin']: 'nord' });
  const original = app.files.get('file:///first/.vscode/settings.json');
  app.readHook(async (uri) => { if (uri.path.startsWith('/first/')) throw new Error('Permission denied'); });
  await app.run();
  assert.equal(app.files.get('file:///first/.vscode/settings.json'), original);
  assert.deepEqual(app.writes, []);
  assert.equal(app.errors.length, 1);
  assert.match(app.errors[0].message, /Folder first.*Permission denied/);
});

test('failed saves leave every old value intact and do not block another scope', async () => {
  const app = setup();
  Object.assign(app.global, { 'colors.comments': '#111111', skin: 'nord', customTheme: { future: true } });
  app.workspace['colors.comments'] = '#222222';
  const original = JSON.parse(JSON.stringify(app.global));
  app.writeHook(async ({ target }) => { if (target === 1) throw new Error('Read only'); });
  await app.run();
  assert.deepEqual(app.global, original);
  assert.deepEqual(app.writes.filter(({ target }) => target === 1).map(({ key }) => key), ['customTheme']);
  assert.deepEqual(app.workspace, { customTheme: { colors: { comments: '#222222' } } });
  assert.equal(app.errors.length, 1);
  assert.match(app.errors[0].message, /User settings.*Read only/);
});

test('a failed folder save preserves its original JSONC and the next folder still migrates', async () => {
  const app = setup();
  const source = '{ // Keep these comments when migration cannot write\n"typoscriptHighlighting.skin": "nord",\n"editor.tabSize": 2,\n}';
  app.put('/first', source);
  app.put('/second', { [SECTION + 'colors.comments']: '#222222' });
  app.writeHook(async ({ target, uri }) => { if (target === 3 && uri.path === '/first') throw new Error('Read only folder'); });
  await app.run();
  assert.equal(app.files.get('file:///first/.vscode/settings.json'), source);
  assert.deepEqual(app.writes.filter(({ uri }) => uri?.path === '/first').map(({ key }) => key), ['customTheme']);
  assert.deepEqual(app.folder('/second'), { [SECTION + 'customTheme']: { colors: { comments: '#222222' } } });
  assert.equal(app.errors.length, 1);
  assert.match(app.errors[0].message, /Folder first.*Read only folder/);
});

test('failed cleanup retains the saved palette and can be retried without overriding newer members', async () => {
  const app = setup([]);
  Object.assign(app.global, { 'colors.comments': '#111111', 'colors.values': '#222222', skin: 'nord' });
  app.writeHook(async ({ key, value }) => { if (key === 'colors.comments' && value === undefined) throw new Error('Cleanup blocked'); });
  await app.run();
  assert.deepEqual(app.global, { 'colors.comments': '#111111', customTheme: {
    colors: { comments: '#111111', values: '#222222' }, legacy: { skin: 'nord' } } });
  assert.equal(app.errors.length, 1);
  assert.match(app.errors[0].message, /remove migrated colors.comments.*Cleanup blocked/);
  app.global.customTheme.colors.comments = '#ABCDEF';
  app.writeHook(undefined);
  await app.run();
  assert.deepEqual(app.global, { customTheme: { colors: { comments: '#ABCDEF', values: '#222222' }, legacy: { skin: 'nord' } } });
});

test('incompatible existing Custom Theme containers are preserved without deleting old data', async () => {
  for (const current of [null, [], 'personal', { colors: null }, { legacy: ['keep'] }]) {
    const app = setup([]);
    Object.assign(app.global, { customTheme: current, 'colors.comments': '#111111', skin: 'nord' });
    const original = JSON.parse(JSON.stringify(app.global));
    await app.run();
    assert.deepEqual(app.global, original);
    assert.deepEqual(app.writes, []);
    assert.equal(app.errors.length, 1);
    assert.match(app.errors[0].message, /not an object/);
  }
});

test('a workspace with no folders still migrates its exact workspace values', async () => {
  const app = setup([]);
  app.vscode.workspace.workspaceFile = Uri.file('/empty.code-workspace');
  app.workspace.commentRules = 'v11';
  await app.run();
  assert.deepEqual(app.workspace, { customTheme: { legacy: { commentRules: 'v11' } } });
  assert.ok(app.writes.every(({ target }) => target === 2));
  assert.deepEqual(app.reads, []);
});
