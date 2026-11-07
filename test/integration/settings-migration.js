const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { parse, ParseErrorCode } = require('jsonc-parser');
const { expected } = require('./settings-fixture');

async function verify() {
  const root = process.env.TYPOSCRIPT_TEST_DIRECTORY;
  const extension = vscode.extensions.getExtension('stefan-sofka.typoscript-highlighting');
  assert.ok(extension, 'The development extension must be registered');
  const api = await extension.activate();
  await api.whenIdle();
  const folderUri = vscode.Uri.file(path.join(root, 'v11', 'setup.typoscript'));
  const otherUri = vscode.Uri.file(path.join(root, 'v14', 'setup.typoscript'));
  const raw = (uri) => vscode.workspace.getConfiguration('typoscriptHighlighting', uri);
  const actual = raw(folderUri).inspect('customTheme');
  assert.deepEqual(actual.globalValue, expected.global, 'User values migrate without replacing existing modern values');
  assert.deepEqual(actual.workspaceValue, expected.workspace, 'Workspace values retain their own scope and modern overrides');
  assert.deepEqual(actual.workspaceFolderValue, expected.folder, 'JSONC folder values including empty colors migrate at folder scope');
  assert.deepEqual(raw(otherUri).inspect('customTheme').workspaceFolderValue, expected.otherFolder, 'Other folders migrate independently');
  assert.equal(raw(folderUri).get('theme'), 'custom', 'Migration preserves the selected Theme');
  assert.deepEqual(raw(folderUri).get('customTheme').colors, {
    comments: '', values: '#123456', operators: '#565656', objectPaths: '#ABCDEF', conditions: '#556677', imports: '#667788',
    constants: '#445566', functions: '#AABBCC', punctuation: '#A0B0C0'
  }, 'The editor preserves per-category User/Workspace/Folder precedence');

  const legacyKeys = new Set(['skin', 'customColors', 'darkColors', 'lightColors', 'commentRules',
    ...['comments', 'objectPaths', 'values', 'operators', 'constants', 'conditions', 'imports', 'functions', 'punctuation'].map((key) => `colors.${key}`)]);
  const files = [
    [path.join(root, 'profile', 'User', 'settings.json'), false],
    [path.join(root, 'test.code-workspace'), true],
    [path.join(root, 'v11', '.vscode', 'settings.json'), false],
    [path.join(root, 'v14', '.vscode', 'settings.json'), false]
  ];
  for (const [file, workspace] of files) {
    const text = await fs.readFile(file, 'utf8');
    const errors = [];
    const parsed = parse(text, errors, { allowTrailingComma: true });
    assert.deepEqual(errors, [], `Migration must retain valid JSONC: ${file}`);
    const data = workspace ? parsed.settings : parsed;
    assert.ok(Object.keys(data).every((key) => !legacyKeys.has(key.replace(/^typoscriptHighlighting\./, ''))), `Legacy keys must be removed only after successful migration: ${file}`);
    assert.ok(text.includes('Migration fixture'), 'Migration must preserve existing settings comments');
  }
  assert.equal(vscode.workspace.getConfiguration('editor', folderUri).inspect('wordWrapColumn').globalValue, 83);
  assert.equal(vscode.workspace.getConfiguration('editor', folderUri).inspect('wordWrapColumn').workspaceFolderValue, 91);
  assert.equal(vscode.workspace.getConfiguration('files').inspect('trimTrailingWhitespace').workspaceValue, true);
  console.log('PASS: settings migration preserves JSONC, existing modern colors, all configuration scopes and unrelated settings');

  const originalFolders = vscode.workspace.workspaceFolders.map(({ uri }) => uri.toString());
  const unchangedFiles = [files[0][0], ...vscode.workspace.workspaceFolders.map(({ uri }) => path.join(uri.fsPath, '.vscode', 'settings.json'))];
  const contents = (file) => fs.readFile(file, 'utf8').catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
  const originalContents = await Promise.all(unchangedFiles.map(contents));
  const addedDirectory = path.join(root, 'added-migration-folder');
  const addedUri = vscode.Uri.file(addedDirectory);
  const addedSettings = path.join(addedDirectory, '.vscode', 'settings.json');
  await fs.mkdir(path.dirname(addedSettings), { recursive: true });
  await fs.writeFile(addedSettings, '// Added while the extension is already active.\n{\n'
    + '  "typoscriptHighlighting.colors.comments": "#315A75",\n'
    + '  "typoscriptHighlighting.commentRules": "v11",\n'
    + '  "typoscriptHighlighting.customTheme": { "colors": { "values": "#AABBCC" } },\n}\n');
  async function changeFolder(add) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { subscription.dispose(); reject(new Error('Timed out waiting for a workspace-folder change')); }, 15000);
      const subscription = vscode.workspace.onDidChangeWorkspaceFolders((event) => {
        if (!(add ? event.added : event.removed).some(({ uri }) => uri.toString() === addedUri.toString())) return;
        clearTimeout(timer); subscription.dispose(); resolve();
      });
      const index = add ? vscode.workspace.workspaceFolders.length
        : vscode.workspace.workspaceFolders.findIndex(({ uri }) => uri.toString() === addedUri.toString());
      if (index < 0 || !vscode.workspace.updateWorkspaceFolders(index, add ? 0 : 1, ...(add ? [{ uri: addedUri }] : []))) {
        clearTimeout(timer); subscription.dispose(); reject(new Error('The test workspace-folder change was rejected'));
      }
    });
    await api.whenIdle();
  }
  try {
    await changeFolder(true);
    assert.deepEqual(raw(addedUri).inspect('customTheme').workspaceFolderValue, {
      colors: { comments: '#315A75', values: '#AABBCC' }, legacy: { commentRules: 'v11' }
    }, 'Folders added to an active workspace migrate before the extension becomes idle');
    const text = await fs.readFile(addedSettings, 'utf8');
    const errors = [];
    const migrated = parse(text, errors, { allowTrailingComma: true });
    assert.deepEqual(errors, [], 'The added folder retains valid JSONC');
    assert.equal(migrated['typoscriptHighlighting.colors.comments'], undefined);
    assert.equal(migrated['typoscriptHighlighting.commentRules'], undefined);
    assert.ok(text.includes('Added while the extension'), 'The added folder retains its comments');
    assert.deepEqual(raw(folderUri).inspect('customTheme'), actual, 'Adding a folder cannot change existing scope values');
    assert.deepEqual(await Promise.all(unchangedFiles.map(contents)), originalContents,
      'Repeated migration must not rewrite already migrated User or original folder files');
    console.log('PASS: adding a folder migrates its legacy settings without reloading or rewriting existing scopes');
  } finally {
    if (vscode.workspace.workspaceFolders.some(({ uri }) => uri.toString() === addedUri.toString())) await changeFolder(false);
    await fs.rm(addedDirectory, { recursive: true, force: true });
  }
  assert.deepEqual(vscode.workspace.workspaceFolders.map(({ uri }) => uri.toString()), originalFolders,
    'The migration fixture restores the original four workspace folders');

  // Restore a truly unconfigured profile for the existing fresh-install scenarios.
  await raw().update('customTheme', undefined, vscode.ConfigurationTarget.Global);
  await raw().update('customTheme', undefined, vscode.ConfigurationTarget.Workspace);
  for (const folder of vscode.workspace.workspaceFolders || []) {
    await raw(folder.uri).update('customTheme', undefined, vscode.ConfigurationTarget.WorkspaceFolder);
  }
  await raw().update('theme', undefined, vscode.ConfigurationTarget.Global);
  await vscode.workspace.getConfiguration('editor').update('wordWrapColumn', undefined, vscode.ConfigurationTarget.Global);
  await vscode.workspace.getConfiguration('editor', folderUri).update('wordWrapColumn', undefined, vscode.ConfigurationTarget.WorkspaceFolder);
  await vscode.workspace.getConfiguration('files').update('trimTrailingWhitespace', undefined, vscode.ConfigurationTarget.Workspace);
  for (const [file, workspace] of files) {
    let text = await fs.readFile(file, 'utf8');
    const errors = [];
    const cleaned = parse(text, errors, { allowTrailingComma: true });
    assert.deepEqual(workspace ? cleaned.settings : cleaned, {}, 'Cleanup must remove only the disposable test settings');
    if (errors.length) {
      // VS Code 1.70 can leave a lone trailing comma when its Settings API
      // deletes the last property. Migration above was checked before cleanup;
      // normalize only these now-empty disposable fixtures for later scenarios.
      assert.ok(errors.every(({ error }) => error === ParseErrorCode.PropertyNameExpected || error === ParseErrorCode.ValueExpected),
        `Unexpected fixture cleanup JSONC errors: ${file}\n${JSON.stringify(text)}`);
      text = `${JSON.stringify(cleaned, null, 2)}\n`;
      await fs.writeFile(file, text);
    }
    const validation = [];
    parse(text, validation, { allowTrailingComma: true });
    assert.deepEqual(validation, [], `Fixture cleanup must retain valid JSONC: ${file}`);
  }
  await api.whenIdle();
}

module.exports = { verify };
