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

async function run() {
  const root = process.env.TYPOSCRIPT_TEST_DIRECTORY;
  assert.ok(root, 'The integration runner must provide an isolated test directory');
  const oldProject = path.join(root, 'old');
  const newProject = path.join(root, 'new');
  await fs.writeFile(path.join(oldProject, 'composer.json'), JSON.stringify({ require: { 'typo3/cms-core': '^11.5' } }));
  await fs.writeFile(path.join(newProject, 'composer.lock'), JSON.stringify({ packages: [{ name: 'typo3/cms-core', version: '13.4.0' }] }));
  await fs.writeFile(path.join(oldProject, 'setup.typoscript'), 'page = PAGE\npage.10 {\nvalue = Hello\n}\n');
  await fs.writeFile(path.join(newProject, 'setup.tsconfig'), 'options.foo = 1\n');
  assert.equal(vscode.workspace.workspaceFolders?.length, 2, 'The runner must open the isolated multi-root workspace');

  const oldUri = vscode.Uri.file(path.join(oldProject, 'setup.typoscript'));
  const newUri = vscode.Uri.file(path.join(newProject, 'setup.tsconfig'));
  await vscode.workspace.openTextDocument(oldUri);
  await vscode.workspace.openTextDocument(newUri);
  const extension = vscode.extensions.getExtension('stefan-sofka.typoscript-highlighting');
  assert.ok(extension, 'The development extension must be registered');
  const controller = await extension.activate();
  await controller.whenIdle();
  const document = (uri) => vscode.workspace.textDocuments.find((entry) => entry.uri.toString() === uri.toString());
  await waitFor('per-project language selection', () => document(oldUri)?.languageId === 'typoscript-v11' && document(newUri)?.languageId === 'typoscript-v12');
  console.log('PASS: real editor activation and mixed-project version detection');

  await fs.writeFile(path.join(oldProject, 'composer.json'), JSON.stringify({ require: { 'typo3/cms-core': '^12.4' } }));
  await waitFor('Composer watcher update', () => document(oldUri)?.languageId === 'typoscript-v12');
  console.log('PASS: real filesystem watcher updates open documents');

  const config = vscode.workspace.getConfiguration('typoscriptHighlighting', oldUri);
  await config.update('commentRules', 'v11', vscode.ConfigurationTarget.WorkspaceFolder);
  await waitFor('folder setting', () => document(oldUri)?.languageId === 'typoscript-v11');
  assert.equal(document(newUri).languageId, 'typoscript-v12');
  await config.update('commentRules', 'auto', vscode.ConfigurationTarget.WorkspaceFolder);
  await waitFor('auto mode restored', () => document(oldUri)?.languageId === 'typoscript-v12');
  console.log('PASS: real resource-scoped configuration changes');

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
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

module.exports = { run };
