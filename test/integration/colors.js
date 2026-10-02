const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { PALETTE, fixture, checks } = require('./color-fixture');

async function run() {
  const root = process.env.TYPOSCRIPT_TEST_DIRECTORY;
  const stateFile = path.join(root, 'color-state.json');
  const ackFile = path.join(root, 'color-ack.json');
  let sequence = 0;
  let api;
  const uris = new Map();
  const native = vscode.workspace.getConfiguration('editor').inspect('tokenColorCustomizations');
  async function stage(name, data = {}) {
    for (const editor of vscode.window.visibleTextEditors) {
      editor.revealRange(new vscode.Range(0, 0, 0, 0), vscode.TextEditorRevealType.AtTop);
    }
    if (api) await api.whenIdle();
    const id = ++sequence;
    await fs.writeFile(`${stateFile}.tmp`, JSON.stringify({ id, name, ...data }));
    await fs.rename(`${stateFile}.tmp`, stateFile);
    const deadline = Date.now() + 40000;
    while (Date.now() < deadline) {
      try {
        const ack = JSON.parse(await fs.readFile(ackFile, 'utf8'));
        if (ack.id === id) {
          if (ack.error) throw new Error(`${name}: ${ack.error}`);
          // Rendering can precede completion of the final webview write.
          if (api) await api.whenIdle();
          assert.deepEqual(vscode.workspace.getConfiguration('editor').inspect('tokenColorCustomizations'), native);
          console.log(`PASS rendered colors: ${name}`);
          return;
        }
      } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    throw new Error(`Color probe timed out: ${name}`);
  }
  const config = (major) => vscode.workspace.getConfiguration('typoscriptHighlighting', uris.get(major));
  async function palette(major, colors, target = vscode.ConfigurationTarget.WorkspaceFolder) {
    for (const category of Object.keys(PALETTE)) await config(major).update(`colors.${category}`, colors[category], target);
  }
  async function show(major, column = vscode.ViewColumn.One) {
    const editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uris.get(major)), column);
    editor.revealRange(new vscode.Range(0, 0, 0, 0), vscode.TextEditorRevealType.AtTop);
    return editor;
  }
  const rendered = (major, colors = PALETTE, grammarMajor = major) => ({
    major, checks: checks(grammarMajor, colors).map((check) => check.line === 0
      ? { ...check, text: `# TYPO3 ${major} Color comment` } : check)
  });

  await vscode.workspace.getConfiguration('workbench').update('colorTheme', 'Default Dark+', vscode.ConfigurationTarget.Global);
  await vscode.workspace.getConfiguration('editor').update('fontSize', 14, vscode.ConfigurationTarget.Global);
  await vscode.workspace.getConfiguration('editor').update('wordWrap', 'off', vscode.ConfigurationTarget.Global);
  await vscode.workspace.getConfiguration('editor').update('bracketPairColorization.enabled', true, vscode.ConfigurationTarget.Global);
  for (const major of [11, 12, 13, 14]) {
    const directory = path.join(root, `v${major}`);
    await fs.writeFile(path.join(directory, 'composer.json'), JSON.stringify({ require: { 'typo3/cms-core': `^${major}.0` } }));
    const uri = vscode.Uri.file(path.join(directory, major === 13 ? 'colors.tsconfig' : 'colors.typoscript'));
    uris.set(major, uri);
    await fs.writeFile(uri.fsPath, major === 13 ? fixture(major).replace(/\n/g, '\r\n') : fixture(major));
  }
  await show(11);
  api = await vscode.extensions.getExtension('stefan-sofka.typoscript-highlighting').activate();
  for (const major of [11, 12, 13, 14]) {
    const editor = await show(major);
    await api.whenIdle();
    assert.equal(editor.document.languageId, major === 11 ? 'typoscript-v11' : 'typoscript-v12');
    if (major === 13) assert.equal(editor.document.eol, vscode.EndOfLine.CRLF);
    await stage(`TYPO3 ${major} default`, { major, baseline: `dark-${major}` });
    await palette(major, PALETTE);
    await stage(`TYPO3 ${major} all nine categories`, rendered(major));
    await palette(major, {});
    await stage(`TYPO3 ${major} exact theme reset`, { major, restore: `dark-${major}` });
  }

  // Verify actual editor rendering under all three configuration levels.
  const comment = async (major, value, target) => config(major).update('colors.comments', value, target);
  await comment(14, '#FF0000', vscode.ConfigurationTarget.Global);
  await comment(14, '#00FF00', vscode.ConfigurationTarget.Workspace);
  await comment(14, '#0000FF', vscode.ConfigurationTarget.WorkspaceFolder);
  await show(14);
  await show(13, vscode.ViewColumn.Two);
  await stage('scope precedence and folder isolation', { documents: [rendered(14, { comments: '#0000FF' }), rendered(13, { comments: '#00FF00' })] });
  await comment(14, '', vscode.ConfigurationTarget.WorkspaceFolder);
  await stage('explicit System Default masks inherited colors', { major: 14, restore: 'dark-14', onlyLine: 0 });
  await comment(14, undefined, vscode.ConfigurationTarget.WorkspaceFolder);
  await comment(14, undefined, vscode.ConfigurationTarget.Workspace);
  await stage('removing workspace override restores user color', rendered(14, { comments: '#FF0000' }));
  await comment(14, undefined, vscode.ConfigurationTarget.Global);
  await stage('removing all overrides restores theme', { major: 14, restore: 'dark-14' });
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await show(14);

  await palette(14, PALETTE);
  await config(14).update('commentRules', 'v11', vscode.ConfigurationTarget.WorkspaceFolder);
  await stage('switching to legacy grammar updates color ranges', rendered(14, PALETTE, 11));
  await config(14).update('commentRules', 'v14', vscode.ConfigurationTarget.WorkspaceFolder);
  await stage('switching back to modern grammar updates color ranges', rendered(14));
  let editor = await show(14);
  assert.ok(await editor.edit((edit) => edit.insert(new vscode.Position(0, 0), '/* open\n')));
  assert.ok(editor.document.getText().startsWith('/* open\n'), 'multiline insertion must update the document');
  await stage('multiline edit recolors following statements', { major: 14, checks: [
    { line: 2, start: 0, text: 'page = Hello {$site.name}', color: PALETTE.comments }
  ] });
  assert.ok(await editor.edit((edit) => edit.replace(new vscode.Range(0, 0, 0, 7), '/* closed */')));
  await stage('closing multiline comment restores category colors', { major: 14, checks: checks(14).map((check) => ({ ...check, line: check.line + 1 })) });
  await editor.edit((edit) => edit.delete(new vscode.Range(0, 0, 1, 0)));
  await stage('subsequent edit preserves all nine categories', rendered(14));
  await editor.document.save();
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await show(14);
  await stage('close and reopen preserves configured colors', rendered(14));

  await palette(14, Object.fromEntries(Object.keys(PALETTE).map((category) => [category, 'custom'])));
  await config(14).update('customColors', PALETTE, vscode.ConfigurationTarget.WorkspaceFolder);
  await stage('all legacy Custom categories still render correctly', rendered(14));
  await config(14).update('customColors', undefined, vscode.ConfigurationTarget.WorkspaceFolder);
  const shared = Object.fromEntries(Object.keys(PALETTE).map((category) => [category, '#112233']));
  await palette(14, shared);
  await stage('one shared color retains every category range', rendered(14, shared));
  await palette(14, { values: '#000000', constants: '#FFFFFF' });
  await stage('black and white colors including nested constants', rendered(14, { values: '#000000', constants: '#FFFFFF' }));
  await palette(14, { values: PALETTE.values });
  await stage('partial overrides leave nested constants at theme default', {
    ...rendered(14, { values: PALETTE.values }), compare: 'dark-14', ranges: [{ line: 1, start: 13, length: 12 }]
  });
  await palette(14, { comments: '#XYZ123', values: '#123' });
  await stage('invalid persisted values fall back to the theme', { major: 14, restore: 'dark-14' });
  await palette(14, {});

  await vscode.workspace.getConfiguration('workbench').update('colorTheme', 'Default Light+', vscode.ConfigurationTarget.Global);
  await stage('light theme default', { major: 14, baseline: 'light-14', differs: 'dark-14' });
  await palette(14, PALETTE);
  await stage('all nine custom colors survive a light theme', rendered(14));
  await vscode.workspace.getConfiguration('workbench').update('colorTheme', 'Default Dark+', vscode.ConfigurationTarget.Global);
  await stage('all nine custom colors survive a theme change', rendered(14));
  await palette(14, {});
  await stage('theme change reset restores current theme exactly', { major: 14, restore: 'dark-14' });

  await vscode.commands.executeCommand('typoscriptHighlighting.configureColors', 'comments');
  await stage('picker UI enters all nine hex colors and adjusts the spectrum', { ...rendered(14), action: 'picker', baselineKey: 'dark-14' });
  assert.equal(config(14).get('colors.comments'), '#BF3030');
  for (const [category, color] of Object.entries(PALETTE)) if (category !== 'comments') assert.equal(config(14).get(`colors.${category}`), color);
  await stage('picker UI resets all nine categories to System Default', { major: 14, action: 'picker-reset', restore: 'dark-14' });
  for (const category of Object.keys(PALETTE)) assert.equal(config(14).inspect(`colors.${category}`).workspaceFolderValue, '');
  await stage('picker UI saves colors at User, Workspace and Folder scopes', {
    ...rendered(14, { comments: '#CC0066' }), action: 'picker-scopes', folderId: `folder:${vscode.workspace.getWorkspaceFolder(uris.get(14)).uri.toString()}`
  });
  const scoped = config(14).inspect('colors.comments');
  assert.equal(scoped.globalValue, '#112233');
  assert.equal(scoped.workspaceValue, '#332211');
  assert.equal(scoped.workspaceFolderValue, '#CC0066');
  await comment(14, undefined, vscode.ConfigurationTarget.Global);
  await comment(14, undefined, vscode.ConfigurationTarget.Workspace);
  await comment(14, undefined, vscode.ConfigurationTarget.WorkspaceFolder);
  await stage('scope picker cleanup restores the theme', { major: 14, restore: 'dark-14' });
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  const plainUri = vscode.Uri.file(path.join(root, 'v14', 'colors.txt'));
  await fs.writeFile(plainUri.fsPath, fixture(99));
  const plain = await vscode.workspace.openTextDocument(plainUri);
  await vscode.window.showTextDocument(plain, vscode.ViewColumn.One);
  assert.equal(plain.languageId, 'plaintext');
  await stage('unrelated language default', { major: 99, baseline: 'plaintext' });
  await palette(14, PALETTE);
  for (const [category, color] of Object.entries(PALETTE)) {
    assert.equal(vscode.workspace.getConfiguration('typoscriptHighlighting', plainUri).get(`colors.${category}`), color);
  }
  await stage('custom colors never affect unrelated languages', { major: 99, restore: 'plaintext' });
  await palette(14, {});
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await stage('complete', { editorVersion: vscode.version,
    extensionVersion: vscode.extensions.getExtension('stefan-sofka.typoscript-highlighting').packageJSON.version });
}

module.exports = { run };
