const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');

async function run(api) {
  const root = path.join(process.env.TYPOSCRIPT_TEST_DIRECTORY, 'v14');
  const extension = path.join(root, 'packages', 'site');
  await fs.mkdir(path.join(extension, 'Configuration'), { recursive: true });
  await fs.writeFile(path.join(extension, 'composer.json'), JSON.stringify({ name: 'example/site', type: 'typo3-cms-extension', extra: { 'typo3/cms': { 'extension-key': 'site' } } }));
  await fs.writeFile(path.join(extension, 'Configuration', '10-first.typoscript'), 'lib.imported = TEXT\n');
  await fs.writeFile(path.join(extension, 'Configuration', '20-last.typoscript'), 'lib.last = TEXT\n');
  await fs.writeFile(path.join(root, 'constants.typoscript'), 'site {\n name = My site\n}\n');
  const uri = vscode.Uri.file(path.join(root, 'features.typoscript'));
  const text = [
    '@import "./constants.typoscript"',
    '@import "EXT:site/Configuration/*.typoscript"',
    'lib {',
    ' title = TEXT',
    ' title.value = Hello {$site.name}',
    ' raw (',
    '  literal { # stays exactly like this',
    ')',
    '}',
    '[site("identifier") == "main"]',
    'page = PAGE',
    '[END]',
    '<INCLUDE_TYPOSCRIPT: source="FILE:./constants.typoscript">',
    ''
  ].join('\r\n');
  await fs.writeFile(uri.fsPath, text);
  let document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document);
  await api.refresh(); await api.whenIdle();
  document = vscode.workspace.textDocuments.find((item) => item.uri.toString() === uri.toString());
  assert.equal(document.languageId, 'typoscript-v12');

  const symbols = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', uri);
  const lib = symbols.find((item) => item.name === 'lib');
  assert.ok(lib?.children.some((item) => item.name === 'title'));
  const commands = await vscode.commands.getCommands();
  // The public test command was introduced after the declared API minimum.
  if (commands.includes('vscode.executeFoldingRangeProvider')) {
    const folding = await vscode.commands.executeCommand('vscode.executeFoldingRangeProvider', uri);
    assert.ok(folding.some((item) => item.start === 2 && item.end >= 7));
  }
  const links = await vscode.commands.executeCommand('vscode.executeLinkProvider', uri);
  assert.ok(links.some((item) => item.target?.path.endsWith('/constants.typoscript')));
  assert.ok(links.some((item) => item.target?.scheme === 'command' && item.target.path === 'typoscriptHighlighting.openImport'));
  console.log('PASS: real outline, structural folding, relative imports and EXT wildcard navigation');

  const refPosition = new vscode.Position(4, document.lineAt(4).text.indexOf('site.name') + 3);
  const definitions = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', uri, refPosition);
  assert.ok(definitions.some((item) => item.uri?.path.endsWith('/constants.typoscript')));
  const refs = await vscode.commands.executeCommand('vscode.executeReferenceProvider', uri, refPosition);
  assert.ok(refs.some((item) => item.uri.path.endsWith('/features.typoscript') && item.range.start.line === 4));
  const hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', uri, refPosition);
  assert.ok(hovers.some((item) => item.contents.some((content) => (content.value || '').includes('My site'))));
  const completionPosition = new vscode.Position(4, document.lineAt(4).text.indexOf('site.name') + 'site.'.length);
  const completions = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', uri, completionPosition);
  assert.ok(completions.items.some((item) => item.label === 'site.name'));
  const snippets = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', uri, new vscode.Position(13, 0));
  assert.ok(snippets.items.some((item) => item.label === 'fluid'));
  assert.ok(!snippets.items.some((item) => item.label === 'tceform'));
  console.log('PASS: project constant definitions, references, hover, completion and contextual setup snippets');

  const legacy = vscode.languages.getDiagnostics(uri).find((item) => item.code === 'legacy-import');
  assert.ok(legacy && legacy.severity === vscode.DiagnosticSeverity.Error);
  assert.ok(!vscode.languages.getDiagnostics(uri).some((item) => item.code === 'brace'));
  const fixes = await vscode.commands.executeCommand('vscode.executeCodeActionProvider', uri, legacy.range, vscode.CodeActionKind.QuickFix.value);
  const fix = fixes.find((item) => item.title === 'Replace with @import');
  assert.ok(fix?.edit);
  assert.ok(await vscode.workspace.applyEdit(fix.edit));
  await api.whenIdle();
  assert.ok(!vscode.languages.getDiagnostics(uri).some((item) => item.code === 'legacy-import'));
  const config = vscode.workspace.getConfiguration('typoscriptHighlighting', uri);
  await config.update('formatting.enabled', true, vscode.ConfigurationTarget.WorkspaceFolder);
  const edits = await vscode.commands.executeCommand('vscode.executeFormatDocumentProvider', uri, { tabSize: 2, insertSpaces: true });
  const formatEdit = new vscode.WorkspaceEdit(); formatEdit.set(uri, edits);
  await vscode.workspace.applyEdit(formatEdit);
  const formatted = vscode.workspace.textDocuments.find((item) => item.uri.toString() === uri.toString()).getText();
  assert.ok(formatted.includes('  title = TEXT\r\n'));
  assert.ok(formatted.includes('  literal { # stays exactly like this\r\n'));
  assert.ok(!formatted.replaceAll('\r\n', '').includes('\n'), 'formatting must preserve CRLF');
  assert.deepEqual(await vscode.commands.executeCommand('vscode.executeFormatDocumentProvider', uri, { tabSize: 2, insertSpaces: true }) || [], []);
  await config.update('formatting.enabled', false, vscode.ConfigurationTarget.WorkspaceFolder);
  console.log('PASS: TYPO3 14 migration diagnostic, quick fix and idempotent value-preserving CRLF formatting');

  const tsconfigUri = vscode.Uri.file(path.join(root, 'features.tsconfig'));
  await fs.writeFile(tsconfigUri.fsPath, '\n');
  await vscode.workspace.openTextDocument(tsconfigUri); await api.whenIdle();
  const tsSnippets = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', tsconfigUri, new vscode.Position(0, 0));
  assert.ok(tsSnippets.items.some((item) => item.label === 'tceform'));
  assert.ok(!tsSnippets.items.some((item) => item.label === 'fluid'));
  await config.update('diagnostics.enabled', false, vscode.ConfigurationTarget.WorkspaceFolder); await api.whenIdle();
  assert.deepEqual(vscode.languages.getDiagnostics(uri), []);
  await config.update('diagnostics.enabled', true, vscode.ConfigurationTarget.WorkspaceFolder);
  await document.save();
  console.log('PASS: contextual TSconfig snippets and per-folder diagnostics switch');
}
module.exports = { run };
