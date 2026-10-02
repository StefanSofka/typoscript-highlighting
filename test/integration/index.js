const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');

async function waitFor(description, predicate) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function waitForComposerWatcher(directory) {
  // File watcher registration is asynchronous, especially in recent VS Code.
  // Wait for an actual event before testing a single version-changing write.
  const filename = path.join(directory, 'composer.json');
  const contents = await fs.readFile(filename);
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(directory), 'composer.{json,lock}'));
  let ready = false;
  let nextWrite = 0;
  const subscription = watcher.onDidChange(() => { ready = true; });
  try {
    await waitFor('Composer watcher registration', async () => {
      if (ready) return true;
      if (Date.now() >= nextWrite) {
        await fs.writeFile(filename, contents);
        nextWrite = Date.now() + 250;
      }
      return false;
    });
  } finally {
    subscription.dispose();
    watcher.dispose();
  }
}

async function run() {
  const root = process.env.TYPOSCRIPT_TEST_DIRECTORY;
  assert.ok(root, 'The integration runner must provide an isolated test directory');
  const oldProject = path.join(root, 'v11');
  const newProject = path.join(root, 'v13');
  const v12Project = path.join(root, 'v12');
  const v14Project = path.join(root, 'v14');
  await fs.writeFile(path.join(oldProject, 'composer.json'), JSON.stringify({ require: { 'typo3/cms-core': '^11.5' } }));
  await fs.writeFile(path.join(newProject, 'composer.json'), JSON.stringify({ require: { 'typo3/cms-core': '^13.4' } }));
  await fs.writeFile(path.join(v12Project, 'composer.lock'), JSON.stringify({ packages: [{ name: 'typo3/cms-core', version: '12.4.0' }] }));
  await fs.writeFile(path.join(v14Project, 'composer.lock'), JSON.stringify({ packages: [{ name: 'typo3/cms-core', version: '14.3.0' }] }));
  await fs.writeFile(path.join(oldProject, 'setup.typoscript'), 'page = PAGE\npage.10 {\nvalue = Hello\n}\n');
  await fs.writeFile(path.join(newProject, 'setup.tsconfig'), 'options.foo = 1\n');
  await fs.writeFile(path.join(v12Project, 'setup.typoscript'), '/**/\npage = PAGE\n');
  await fs.writeFile(path.join(v14Project, 'setup.typoscript'), '/**/\npage = PAGE\n');
  assert.equal(vscode.workspace.workspaceFolders?.length, 4, 'The runner must open the isolated multi-root workspace');

  const oldUri = vscode.Uri.file(path.join(oldProject, 'setup.typoscript'));
  const newUri = vscode.Uri.file(path.join(newProject, 'setup.tsconfig'));
  const v12Uri = vscode.Uri.file(path.join(v12Project, 'setup.typoscript'));
  const v14Uri = vscode.Uri.file(path.join(v14Project, 'setup.typoscript'));
  await vscode.workspace.openTextDocument(oldUri);
  await vscode.workspace.openTextDocument(newUri);
  await vscode.workspace.openTextDocument(v12Uri);
  await vscode.workspace.openTextDocument(v14Uri);
  const extension = vscode.extensions.getExtension('stefan-sofka.typoscript-highlighting');
  assert.ok(extension, 'The development extension must be registered');
  const controller = await extension.activate();
  await controller.whenIdle();
  const document = (uri) => vscode.workspace.textDocuments.find((entry) => entry.uri.toString() === uri.toString());
  const modernUris = [v12Uri, newUri, v14Uri];
  await waitFor('per-project language selection', () => document(oldUri)?.languageId === 'typoscript-v11'
    && modernUris.every((uri) => document(uri)?.languageId === 'typoscript-v12'));
  console.log('PASS: real editor activation and mixed TYPO3 11/12/13/14 project detection');

  await waitForComposerWatcher(oldProject);
  await controller.whenIdle();
  await fs.writeFile(path.join(oldProject, 'composer.json'), JSON.stringify({ require: { 'typo3/cms-core': '^14.3' } }));
  await waitFor('Composer watcher update', () => document(oldUri)?.languageId === 'typoscript-v12');
  console.log('PASS: real filesystem watcher updates open documents');

  const config = vscode.workspace.getConfiguration('typoscriptHighlighting', oldUri);
  await config.update('commentRules', 'v11', vscode.ConfigurationTarget.WorkspaceFolder);
  await waitFor('folder setting', () => document(oldUri)?.languageId === 'typoscript-v11');
  assert.ok(modernUris.every((uri) => document(uri).languageId === 'typoscript-v12'));
  await config.update('commentRules', 'auto', vscode.ConfigurationTarget.WorkspaceFolder);
  await waitFor('auto mode restored', () => document(oldUri)?.languageId === 'typoscript-v12');
  console.log('PASS: real resource-scoped configuration changes');

  for (const [major, uri] of [[13, newUri], [14, v14Uri]]) {
    const modernConfig = vscode.workspace.getConfiguration('typoscriptHighlighting', uri);
    await modernConfig.update('commentRules', 'v11', vscode.ConfigurationTarget.WorkspaceFolder);
    await waitFor(`TYPO3 ${major} forced legacy rules`, () => document(uri)?.languageId === 'typoscript-v11');
    assert.ok(modernUris.filter((other) => other !== uri).every((other) => document(other).languageId === 'typoscript-v12'));
    await modernConfig.update('commentRules', `v${major}`, vscode.ConfigurationTarget.WorkspaceFolder);
    await waitFor(`TYPO3 ${major} forced modern rules`, () => document(uri)?.languageId === 'typoscript-v12');
    await modernConfig.update('commentRules', 'auto', vscode.ConfigurationTarget.WorkspaceFolder);
    await controller.whenIdle();
    assert.equal(document(uri).languageId, 'typoscript-v12');
    console.log(`PASS: TYPO3 ${major} auto/v11/v${major} settings in the real editor`);
  }

  await vscode.languages.setTextDocumentLanguage(document(oldUri), 'typoscript-v11');
  await controller.whenIdle();
  await controller.refresh();
  assert.equal(document(oldUri).languageId, 'typoscript-v11');
  await vscode.languages.setTextDocumentLanguage(document(oldUri), 'typoscript');
  await waitFor('automatic detection after manual reset', () => document(oldUri)?.languageId === 'typoscript-v12');
  console.log('PASS: real manual language selection and reset');

  const editor = await vscode.window.showTextDocument(document(oldUri));
  editor.selection = new vscode.Selection(0, 0, 0, 0);
  await vscode.commands.executeCommand('editor.action.commentLine');
  assert.match(editor.document.lineAt(0).text, /^#\s*page/);
  await vscode.commands.executeCommand('editor.action.commentLine');
  assert.equal(editor.document.lineAt(0).text, 'page = PAGE');
  console.log('PASS: registered language configuration supports comment toggling');

  const colorSetting = vscode.workspace.getConfiguration('typoscriptHighlighting', oldUri);
  const nativeColors = vscode.workspace.getConfiguration('editor').inspect('tokenColorCustomizations');
  for (const category of ['comments', 'objectPaths', 'values', 'operators', 'constants', 'conditions', 'imports', 'functions', 'punctuation']) {
    assert.equal(colorSetting.get(`colors.${category}`), '', 'System Default must be the initial color');
  }
  await colorSetting.update('colors.comments', '#12AB34', vscode.ConfigurationTarget.WorkspaceFolder);
  await colorSetting.update('colors.values', 'custom', vscode.ConfigurationTarget.WorkspaceFolder);
  await colorSetting.update('customColors', { values: '#AB1234' }, vscode.ConfigurationTarget.WorkspaceFolder);
  await controller.whenIdle();
  assert.equal(vscode.workspace.getConfiguration('typoscriptHighlighting', oldUri).get('colors.comments'), '#12AB34');
  assert.equal(vscode.workspace.getConfiguration('typoscriptHighlighting', oldUri).get('colors.values'), 'custom');
  assert.deepEqual(vscode.workspace.getConfiguration('typoscriptHighlighting', oldUri).get('customColors'), { values: '#AB1234' });
  assert.equal(vscode.workspace.getConfiguration('typoscriptHighlighting', v14Uri).get('colors.comments'), '');
  await vscode.languages.setTextDocumentLanguage(editor.document, 'typoscript-v11');
  await controller.whenIdle();
  await vscode.languages.setTextDocumentLanguage(editor.document, 'typoscript');
  await controller.whenIdle();
  await colorSetting.update('colors.comments', '', vscode.ConfigurationTarget.WorkspaceFolder);
  await colorSetting.update('colors.values', '', vscode.ConfigurationTarget.WorkspaceFolder);
  await colorSetting.update('customColors', undefined, vscode.ConfigurationTarget.WorkspaceFolder);
  await controller.whenIdle();
  assert.deepEqual(vscode.workspace.getConfiguration('editor').inspect('tokenColorCustomizations'), nativeColors,
    'Custom colors must not rewrite native token color settings');
  console.log('PASS: direct hex/legacy custom colors, resource settings, language changes, and System Default reset');
  const originalColors = Object.fromEntries(['comments', 'objectPaths', 'values', 'operators', 'constants', 'conditions', 'imports', 'functions', 'punctuation']
    .map((category) => [category, vscode.workspace.getConfiguration('typoscriptHighlighting', oldUri).inspect(`colors.${category}`)]));
  await vscode.commands.executeCommand('typoscriptHighlighting.configureColors', 'values');
  await vscode.commands.executeCommand('typoscriptHighlighting.configureColors', 'comments');
  await controller.whenIdle();
  for (const [category, original] of Object.entries(originalColors)) {
    assert.deepEqual(vscode.workspace.getConfiguration('typoscriptHighlighting', oldUri).inspect(`colors.${category}`), original,
      'Opening the spectrum view must not save a color');
  }
  console.log('PASS: registered spectrum command opens and reuses its view without changing settings');
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

module.exports = { run };
