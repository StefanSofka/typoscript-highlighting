const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { getSettings } = require('../../lib/settings');
const { PALETTE, fixture, checks } = require('./color-fixture');
// Independent expected foregrounds for the bundled skins.
const SKIN_COLORS = {
  dark: { comments: '#7FA870', objectPaths: '#9CDCFE', values: '#CE9178', operators: '#C586C0', constants: '#4FC1FF', conditions: '#DCDCAA', imports: '#D7BA7D', functions: '#B5CEA8', punctuation: '#D4D4D4' },
  light: { comments: '#426B35', objectPaths: '#005A9C', values: '#A31515', operators: '#6F2B94', constants: '#007080', conditions: '#795E26', imports: '#8A4500', functions: '#176F2C', punctuation: '#383A42' },
  nord: { comments: '#A3BE8C', objectPaths: '#88C0D0', values: '#EBCB8B', operators: '#B48EAD', constants: '#D08770', conditions: '#81A1C1', imports: '#8FBCBB', functions: '#E5C07B', punctuation: '#D8DEE9' },
  monokai: { comments: '#A6AA95', objectPaths: '#A6E22E', values: '#E6DB74', operators: '#F56A9B', constants: '#AE81FF', conditions: '#66D9EF', imports: '#FDAD60', functions: '#A6E22E', punctuation: '#F8F8F2' },
  solarized: { comments: '#8BA4A6', objectPaths: '#6CB6E8', values: '#BFA34B', operators: '#D67EC1', constants: '#9CA0F5', conditions: '#7EB846', imports: '#53B5AB', functions: '#EE8C69', punctuation: '#A8BFC0' }
};

async function run() {
  const root = process.env.TYPOSCRIPT_TEST_DIRECTORY;
  await require('./settings-migration').verify();
  const stateFile = path.join(root, 'color-state.json');
  const ackFile = path.join(root, 'color-ack.json');
  let sequence = 0;
  let api;
  const uris = new Map();
  const native = vscode.workspace.getConfiguration('editor').inspect('tokenColorCustomizations');
  async function stage(name, data = {}) {
    const separateScreenshot = data.maximize && process.env.TYPOSCRIPT_SCREENSHOT_DIR;
    for (const editor of vscode.window.visibleTextEditors) {
      editor.revealRange(new vscode.Range(0, 0, 0, 0), vscode.TextEditorRevealType.AtTop);
    }
    if (api) await api.whenIdle();
    if (data.screenshot && process.env.TYPOSCRIPT_SCREENSHOT_DIR) {
      await vscode.commands.executeCommand('notifications.clearAll');
    }
    const id = ++sequence;
    await fs.writeFile(`${stateFile}.tmp`, JSON.stringify({ id, name, ...data, ...(separateScreenshot ? { screenshot: undefined } : {}) }));
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
          if (separateScreenshot) {
            if (data.palette === 'dark') await stage('dark palette editor preview', { screenshot: 'custom-colors-dark.png' });
            await vscode.commands.executeCommand('workbench.action.maximizeEditorHideSidebar');
            await stage(`${name} screenshot`, { screenshot: data.screenshot });
            await vscode.commands.executeCommand('workbench.action.evenEditorWidths');
          }
          return;
        }
      } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    throw new Error(`Color probe timed out: ${name}`);
  }
  const config = (major) => getSettings(vscode, uris.get(major));
  async function savedSetting(key, expected) {
    const deadline = Date.now() + 10000;
    while (getSettings(vscode).get(key) !== expected && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(getSettings(vscode).get(key), expected, `native Settings persisted ${key}`);
  }
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
    const site = path.join(directory, 'packages', 'site');
    await fs.mkdir(site, { recursive: true });
    await fs.writeFile(path.join(site, 'composer.json'), JSON.stringify({ name: 'example/site', type: 'typo3-cms-extension', extra: { 'typo3/cms': { 'extension-key': 'site' } } }));
    await fs.writeFile(path.join(site, 'setup.typoscript'), '# Imported site configuration\n');
    await fs.writeFile(path.join(directory, 'composer.json'), JSON.stringify({ require: { 'typo3/cms-core': `^${major}.0` } }));
    const uri = vscode.Uri.file(path.join(directory, major === 13 ? 'colors.tsconfig' : 'colors.typoscript'));
    uris.set(major, uri);
    await fs.writeFile(uri.fsPath, major === 13 ? fixture(major).replace(/\n/g, '\r\n') : fixture(major));
  }
  await show(11);
  api = await vscode.extensions.getExtension('stefan-sofka.typoscript-highlighting').activate();
  for (const property of ['globalValue', 'workspaceValue', 'workspaceFolderValue']) assert.equal(config(11).inspect('skin')[property], undefined);
  await stage('fresh installation automatically uses Dark skin', rendered(11, SKIN_COLORS.dark));
  await getSettings(vscode).update('skin', 'editor', vscode.ConfigurationTarget.Global);
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
  await config(14).update('commentRules', undefined, vscode.ConfigurationTarget.WorkspaceFolder);

  await vscode.workspace.getConfiguration('workbench').update('colorTheme', 'Default Light+', vscode.ConfigurationTarget.Global);
  await stage('light theme default', { major: 14, baseline: 'light-14', differs: 'dark-14' });
  await palette(14, PALETTE);
  await stage('all nine custom colors survive a light theme', rendered(14));
  await vscode.workspace.getConfiguration('workbench').update('colorTheme', 'Default Dark+', vscode.ConfigurationTarget.Global);
  await stage('all nine custom colors survive a theme change', rendered(14));
  await palette(14, {});
  await stage('theme change reset restores current theme exactly', { major: 14, restore: 'dark-14' });

  await vscode.commands.executeCommand('workbench.action.joinAllGroups');
  await vscode.commands.executeCommand('workbench.action.closeSidebar');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  const userConfig = () => getSettings(vscode);
  await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:stefan-sofka.typoscript-highlighting');
  await stage('native Settings exposes Theme selection', { action: 'settings-theme', theme: 'nord', screenshot: 'theme-settings.png', editorScreenshot: true });
  await savedSetting('theme', 'nord');
  await show(14);
  await stage('preset selected in native Settings colors all categories', rendered(14, SKIN_COLORS.nord));
  await comment(14, '#112233', vscode.ConfigurationTarget.Global);
  for (const [theme, colors] of Object.entries(SKIN_COLORS)) {
    await userConfig().update('theme', theme, vscode.ConfigurationTarget.Global);
    await stage(`${theme} preset ignores stored custom colors`, rendered(14, colors));
  }
  assert.equal(userConfig().get('colors.comments'), '#112233');
  await comment(14, undefined, vscode.ConfigurationTarget.Global);
  await userConfig().update('theme', 'nord', vscode.ConfigurationTarget.Global);
  await vscode.commands.executeCommand('_extensions.manage', 'stefan-sofka.typoscript-highlighting');
  if (process.env.TYPOSCRIPT_VERIFY_PREVIEW_README) {
    const extension = vscode.extensions.getExtension('stefan-sofka.typoscript-highlighting');
    const readme = await fs.readFile(path.join(extension.extensionPath, 'readme.md'), 'utf8');
    const expectedImages = [...readme.matchAll(/!\[[^\]]*\]\(https:\/\/raw\.githubusercontent\.com\//g)].length;
    assert.ok(expectedImages > 0, 'load a pinned-image release or preview VSIX for README verification');
    await stage('all README screenshots load in extension Details', {
      action: 'extension-readme', expectedImages, screenshot: 'readme-preview.png', editorScreenshot: true
    });
  }
  await stage('the extension menu opens visual Theme Settings directly', {
    action: 'extension-theme-menu', menuScreenshot: 'theme-settings-menu.png', screenshot: 'theme-settings-entry.png'
  });
  await stage('Theme Settings starts with nine colors and one Save button', { action: 'custom-open', screenshot: 'custom-theme.png' });
  await stage('custom editor has only nine colors and Save; drafts do not change settings', {
    action: 'custom-draft', paletteColors: PALETTE
  });
  assert.equal(userConfig().get('theme'), 'nord');
  assert.equal(userConfig().inspect('colors.comments').globalValue, undefined);
  for (const [theme, colors] of Object.entries(SKIN_COLORS)) {
    await stage(`panel dropdown selects ${theme} and fills all nine editable colors`, { action: 'panel-theme', theme, paletteColors: colors,
      ...(theme === 'dark' ? { screenshot: 'theme-dark-visible.png' } : theme === 'nord' ? { screenshot: 'theme-switcher.png' } : {}) });
    assert.equal(userConfig().get('theme'), theme);
    assert.equal(userConfig().inspect('colors.comments').globalValue, undefined, 'preset selection must not save the custom draft');
  }
  await userConfig().update('theme', 'nord', vscode.ConfigurationTarget.Global);
  await stage('native theme change synchronizes the panel dropdown', { action: 'panel-external', theme: 'nord', paletteColors: SKIN_COLORS.nord });
  await stage('returning to Custom restores the unsaved color draft', { action: 'panel-custom', paletteColors: PALETTE });
  assert.equal(userConfig().get('theme'), 'nord', 'Custom drafts are applied only on Save');
  await stage('custom editor saves the palette and selects Custom', { action: 'custom-save' });
  assert.equal(userConfig().get('theme'), 'custom');
  for (const [category, color] of Object.entries(PALETTE)) assert.equal(userConfig().get(`colors.${category}`), color);
  assert.deepEqual(vscode.workspace.getConfiguration('typoscriptHighlighting').inspect('customTheme').globalValue.colors, PALETTE,
    'the visual editor must persist the nine colors in the compact customTheme setting');
  assert.equal(vscode.workspace.getConfiguration('typoscriptHighlighting').inspect('customTheme').globalValue.legacy.skin, 'editor',
    'saving custom colors must preserve existing legacy settings in the same scope');
  await userConfig().update('theme', 'nord', vscode.ConfigurationTarget.Global);
  await stage('a preset supplies all nine editable fields despite stored custom colors', { action: 'panel-external', theme: 'nord', paletteColors: SKIN_COLORS.nord });
  const customizedPreset = { ...SKIN_COLORS.nord, comments: '#7FB069' };
  await stage('adjusting one preset color starts a custom theme and keeps the other eight', {
    action: 'panel-adjust-one', paletteColors: customizedPreset, screenshot: 'theme-adjusted.png'
  });
  assert.equal(userConfig().get('theme'), 'nord');
  assert.equal(userConfig().get('colors.comments'), PALETTE.comments, 'edits stay in the preview until Save');
  await vscode.workspace.getConfiguration('workbench').update('colorTheme', 'Default Light+', vscode.ConfigurationTarget.Global);
  await stage('editor appearance changes preserve all colors of the custom draft', { action: 'panel-check-draft', paletteColors: customizedPreset });
  await vscode.workspace.getConfiguration('workbench').update('colorTheme', 'Default Dark+', vscode.ConfigurationTarget.Global);
  await stage('saving the one-color adjustment stores the complete customized preset', { action: 'custom-save' });
  assert.equal(userConfig().get('theme'), 'custom');
  for (const [category, color] of Object.entries(customizedPreset)) assert.equal(userConfig().get(`colors.${category}`), color, category);
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  await show(14);
  await stage('saved one-color adjustment renders with the other eight preset colors', rendered(14, customizedPreset));
  await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:stefan-sofka.typoscript-highlighting');
  await stage('native Settings shows five useful entries without duplicate or legacy color fields', {
    action: 'settings-clean', screenshot: 'theme-settings.png', editorScreenshot: true
  });
  await stage('the native Settings link opens the visual editor with the saved palette', {
    action: 'settings-open-theme', paletteColors: customizedPreset
  });
  const edited = { ...customizedPreset, comments: '#467240' };
  await stage('the visual editor changes one saved custom color through the native entry point', {
    action: 'panel-adjust-one', paletteColors: edited
  });
  await stage('the visual editor saves the color selected through native Settings', { action: 'custom-save' });
  assert.deepEqual(vscode.workspace.getConfiguration('typoscriptHighlighting').inspect('customTheme').globalValue.colors, edited);
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  await show(14);
  await stage('the saved custom color updates real syntax highlighting', rendered(14, edited));
  await userConfig().update('theme', 'dark', vscode.ConfigurationTarget.Global);
  await stage('switching from Custom to a preset uses the complete preset', rendered(14, SKIN_COLORS.dark));
  await userConfig().update('theme', 'custom', vscode.ConfigurationTarget.Global);
  await stage('switching back to Custom restores the saved colors', rendered(14, edited));
  await userConfig().update('theme', 'auto', vscode.ConfigurationTarget.Global);
  await vscode.workspace.getConfiguration('workbench').update('colorTheme', 'Default Light+', vscode.ConfigurationTarget.Global);
  await stage('Automatic chooses Light without mixing in custom colors', rendered(14, SKIN_COLORS.light));
  await vscode.workspace.getConfiguration('workbench').update('colorTheme', 'Default Dark+', vscode.ConfigurationTarget.Global);
  await stage('Automatic chooses Dark again', rendered(14, SKIN_COLORS.dark));
  await userConfig().update('theme', undefined, vscode.ConfigurationTarget.Global);
  for (const category of Object.keys(PALETTE)) await userConfig().update(`colors.${category}`, undefined, vscode.ConfigurationTarget.Global);
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  const plainUri = vscode.Uri.file(path.join(root, 'v14', 'colors.txt'));
  await fs.writeFile(plainUri.fsPath, fixture(99));
  const plain = await vscode.workspace.openTextDocument(plainUri);
  await vscode.window.showTextDocument(plain, vscode.ViewColumn.One);
  assert.equal(plain.languageId, 'plaintext');
  await stage('unrelated language default', { major: 99, baseline: 'plaintext' });
  await palette(14, PALETTE);
  for (const [category, color] of Object.entries(PALETTE)) {
    assert.equal(getSettings(vscode, plainUri).get(`colors.${category}`), color);
  }
  await stage('custom colors never affect unrelated languages', { major: 99, restore: 'plaintext' });
  await palette(14, {});
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await vscode.commands.executeCommand('workbench.action.joinAllGroups');
  await require('./features').run(api);
  await vscode.commands.executeCommand('workbench.view.explorer');
  await vscode.commands.executeCommand('outline.focus');
  await stage('project navigation and outline', { screenshot: 'project-navigation.png' });
  if (process.env.TYPOSCRIPT_SCREENSHOT_DIR) {
    await require('./installation').run(api, stage);
    await require('./site-sets').run(api, stage);
  }
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await stage('complete', { editorVersion: vscode.version,
    extensionVersion: vscode.extensions.getExtension('stefan-sofka.typoscript-highlighting').packageJSON.version });
}

module.exports = { run };
