const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const coreFile = 'Classes/Information/Typo3Version.php';
const php = (version) => `<?php\nnamespace TYPO3\\CMS\\Core\\Information;\nclass Typo3Version { protected const VERSION = '${version}'; }\n`;
async function write(filename, text) { await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename, text); }
async function waitFor(name, check) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${name}`);
}
async function run(api, capture) {
  const project = path.join(process.env.TYPOSCRIPT_TEST_DIRECTORY, 'v14');
  const classic = path.join(project, 'classic');
  for (const version of ['11.5.42', '14.3.0']) await write(path.join(project, 'cores', version, 'typo3/sysext/core', coreFile), php(version));
  await fs.mkdir(classic, { recursive: true });
  await fs.symlink('../cores/11.5.42', path.join(classic, 'typo3_src'));
  await fs.symlink('typo3_src/typo3', path.join(classic, 'typo3'));
  const uri = vscode.Uri.file(path.join(classic, 'typo3conf/ext/my_classic/Configuration/TypoScript/setup.typoscript'));
  await write(uri.fsPath, '@import "EXT:my_classic/Configuration/TypoScript/constants.typoscript"\npage.10 = TEXT\npage.10.value = {$site.title}\n\npage = PAGE\npage {\n  typeNum = 0\n  10.wrap = <h1>|</h1>\n  20 = FLUIDTEMPLATE\n  20 {\n    file = EXT:my_classic/Resources/Private/Templates/Default.html\n    variables {\n      title = TEXT\n      title.value = {$site.title}\n    }\n  }\n}\n');
  await write(path.join(classic, 'typo3conf/ext/my_classic/Configuration/TypoScript/constants.typoscript'), 'site.title = Classic site\n');
  await vscode.workspace.openTextDocument(uri); await api.refresh(); await api.whenIdle();
  const document = () => vscode.workspace.textDocuments.find((entry) => entry.uri.toString() === uri.toString());
  assert.equal(document().languageId, 'typoscript-v11');
  assert.equal(api.getInfo(document()).installation, 'classic');
  const links = await vscode.commands.executeCommand('vscode.executeLinkProvider', uri);
  assert.ok(links.some((link) => link.target?.path.endsWith('/my_classic/Configuration/TypoScript/constants.typoscript')));
  console.log('PASS: Classic symlink core and EXT imports without Composer manifests, nested inside a different-version project');
  async function detectionScreenshot(document, filename) {
    if (!capture) return;
    await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
    const menu = vscode.commands.executeCommand('typoscriptHighlighting.showVersion');
    await capture(`automatic TYPO3 detection details (${filename.includes('classic') ? 'Classic' : 'Composer'})`, { screenshot: filename, editorScreenshot: true });
    await vscode.commands.executeCommand('workbench.action.closeQuickOpen'); await menu;
  }
  await detectionScreenshot(document(), 'automatic-detection-classic.png');

  // Do not call refresh: this also exercises the fallback for omitted symlink events.
  await fs.unlink(path.join(classic, 'typo3_src')); await fs.symlink('../cores/14.3.0', path.join(classic, 'typo3_src'));
  await waitFor('automatic version change after switching typo3_src', () => api.getInfo(document())?.version === '14.3.0' && document().languageId === 'typoscript-v12');
  console.log('PASS: active typo3_src switch updates an open document automatically');

  const custom = path.join(project, 'custom-composer');
  await write(path.join(custom, 'composer.json'), JSON.stringify({ require: { 'typo3/cms-core': '^14' }, config: { 'vendor-dir': 'dependencies' }, extra: { 'typo3/cms': { 'web-dir': 'www' } } }));
  await write(path.join(custom, 'composer.lock'), JSON.stringify({ packages: [{ name: 'typo3/cms-core', version: '14.3.0' }] }));
  await write(path.join(custom, 'dependencies/typo3/cms-core', coreFile), php('13.4.0'));
  const extension = path.join(custom, 'packages/site');
  await write(path.join(extension, 'composer.json'), JSON.stringify({ type: 'typo3-cms-extension', name: 'example/site', require: { 'typo3/cms-core': '^11 || ^12 || ^13 || ^14' }, extra: { 'typo3/cms': { 'extension-key': 'site' } } }));
  await write(path.join(custom, 'dependencies/example/library/composer.json'), JSON.stringify({ type: 'typo3-cms-extension', name: 'example/library', extra: { 'typo3/cms': { 'extension-key': 'library' } } }));
  await write(path.join(custom, 'dependencies/example/library/setup.typoscript'), 'lib.library = TEXT\n');
  const customUri = vscode.Uri.file(path.join(extension, 'setup.typoscript'));
  const text = '@import "EXT:library/setup.typoscript"\npage.10 = FLU\npage.20 = TEXT\npage.20.va\npage.20.value = {$site.title}\npage.30 = PA\n';
  await write(customUri.fsPath, text);
  await write(path.join(custom, 'config/sites/main/config.yaml'), 'dependencies: [vendor/main]\n');
  await write(path.join(extension, 'Configuration/Sets/Main/config.yaml'), 'name: vendor/main\nlabel: Main site\n');
  await write(path.join(custom, 'config/sites/main/settings.yaml'), 'site.title: Website from YAML\n');
  await write(path.join(extension, 'Configuration/Sets/Main/settings.definitions.yaml'), 'settings:\n  site.title:\n    type: string\n    default: Default title\n    label: Website title\n');
  await vscode.workspace.openTextDocument(customUri); await api.refresh(); await api.whenIdle();
  const current = () => vscode.workspace.textDocuments.find((entry) => entry.uri.toString() === customUri.toString());
  const info = api.getInfo(current());
  assert.equal(info.root.fsPath, custom); assert.equal(info.version, '13.4.0'); assert.equal(info.conflict.version, '14.3.0'); assert.equal(info.webRoot.fsPath, path.join(custom, 'www'));
  const customLinks = await vscode.commands.executeCommand('vscode.executeLinkProvider', customUri);
  assert.ok(customLinks.some((link) => link.target?.path.endsWith('/dependencies/example/library/setup.typoscript')));
  const ref = new vscode.Position(4, 24);
  const definitions = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', customUri, ref);
  assert.ok(definitions.some((entry) => entry.uri?.path.endsWith('/config/sites/main/settings.yaml')));
  assert.ok(definitions.some((entry) => entry.uri?.path.endsWith('/Configuration/Sets/Main/settings.definitions.yaml')));
  const hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', customUri, ref);
  assert.ok(hovers.some((entry) => entry.contents.some((content) => content.value?.includes('Website from YAML'))));
  const constants = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', customUri, new vscode.Position(4, 27));
  assert.ok(constants.items.some((item) => item.label === 'site.title'));
  for (const [line, character, label] of [[1, 13, 'FLUIDTEMPLATE'], [3, 10, 'value'], [5, 12, 'PAGEVIEW']]) {
    const completions = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', customUri, new vscode.Position(line, character));
    assert.ok(completions.items.some((item) => item.label === label), `Expected ${label} completion`);
  }
  console.log('PASS: installed Composer version/conflict, custom roots, enclosing site detection, YAML navigation/hover/completion and version-aware core suggestions');
  if (capture) {
    const edits = new vscode.WorkspaceEdit();
    for (const [line, text] of [[1, 'page.10 = FLUIDTEMPLATE'], [3, 'page.20.wrap = <h1>|</h1>'], [5, 'page.30 = PAGEVIEW']]) edits.replace(customUri, current().lineAt(line).range, text);
    edits.insert(customUri, new vscode.Position(6, 0), '\npage = PAGE\npage.30 {\n  paths.100 = EXT:site/Resources/Private/PageView/\n  variables {\n    title = TEXT\n    title.value = {$site.title}\n  }\n}\n');
    await vscode.workspace.applyEdit(edits); await current().save(); await api.whenIdle();
    await detectionScreenshot(current(), 'automatic-detection-composer.png');
    const editor = await vscode.window.showTextDocument(current()); editor.selection = new vscode.Selection(ref, ref);
    await vscode.commands.executeCommand('editor.action.peekDefinition');
    await capture('site settings definitions in YAML', { screenshot: 'site-settings-navigation.png', editorScreenshot: true });
    await vscode.commands.executeCommand('closeReferenceSearch');
  }

  const settingsUri = vscode.Uri.file(path.join(custom, 'config/sites/main/settings.yaml'));
  const settings = await vscode.workspace.openTextDocument(settingsUri);
  const edit = new vscode.WorkspaceEdit(); edit.replace(settingsUri, new vscode.Range(0, 0, settings.lineCount, 0), 'site.title: Unsaved YAML title\n');
  await vscode.workspace.applyEdit(edit); await api.whenIdle();
  const changed = await vscode.commands.executeCommand('vscode.executeHoverProvider', customUri, ref);
  assert.ok(changed.some((entry) => entry.contents.some((content) => content.value?.includes('Unsaved YAML title'))));
  await settings.save();
  console.log('PASS: unsaved YAML settings edits invalidate hover and definition caches');
}

module.exports = { run };
