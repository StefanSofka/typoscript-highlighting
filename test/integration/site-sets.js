const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');

async function write(filename, text) { await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename, text); }
const current = (uri) => vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === uri.toString());
async function open(filename) { return vscode.workspace.openTextDocument(vscode.Uri.file(filename)); }
function position(document, text, offset = 2) {
  const index = document.getText().indexOf(text); assert.ok(index >= 0, text);
  return document.positionAt(index + offset);
}
async function replace(document, text) {
  const edit = new vscode.WorkspaceEdit(); edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), text);
  assert.ok(await vscode.workspace.applyEdit(edit));
}
async function applyCompletion(document, item) {
  assert.ok(item, 'Expected completion item');
  const edit = new vscode.WorkspaceEdit(); edit.replace(document.uri, item.range, item.insertText);
  assert.ok(await vscode.workspace.applyEdit(edit));
}

async function run(api, capture) {
  const root = path.join(process.env.TYPOSCRIPT_TEST_DIRECTORY, 'v13', 'site-sets');
  const sitePackage = path.join(root, 'packages/site');
  const base = path.join(root, 'dependencies/acme/base/Configuration/Sets/Base');
  const main = path.join(sitePackage, 'Configuration/Sets/Main');
  const unused = path.join(sitePackage, 'Configuration/Sets/Unused');
  const site = path.join(root, 'config/sites/main');
  await write(path.join(root, 'composer.json'), JSON.stringify({ require: { 'typo3/cms-core': '^13.4' }, config: { 'vendor-dir': 'dependencies' }, extra: { 'typo3/cms': { 'web-dir': 'www' } } }));
  await write(path.join(sitePackage, 'composer.json'), JSON.stringify({ name: 'acme/site-package', type: 'typo3-cms-extension', extra: { 'typo3/cms': { 'extension-key': 'site_package' } } }));
  await write(path.join(root, 'dependencies/acme/base/composer.json'), JSON.stringify({ name: 'acme/base', type: 'typo3-cms-extension' }));
  await write(path.join(base, 'config.yaml'), 'name: acme/base\nlabel: Shared foundation\nhidden: true\n');
  await write(path.join(base, 'settings.definitions.yaml'), 'settings:\n  site.title:\n    type: string\n    default: Default website\n    label: Website title\n    description: Title shared by all pages\n  site.mode:\n    type: string\n    default: light\n    enum:\n      light: Light theme\n      dark: Dark theme\n  site.features:\n    type: stringlist\n    default: [search, contact]\n  site.enabled:\n    type: bool\n    default: true\n');
  await write(path.join(base, 'setup.typoscript'), 'lib.base = TEXT\nlib.base.value = {$site.title}\n');
  await write(path.join(base, 'constants.typoscript'), 'site.legacy = Foundation\n');
  await write(path.join(base, 'page.tsconfig'), 'TCEMAIN.preview = 1\n');
  await write(path.join(main, 'config.yaml'), 'name: acme/website\nlabel: Website\ndependencies:\n  - acme/base\noptionalDependencies:\n  - acme/not-installed\n');
  await write(path.join(main, 'setup.typoscript'), 'lib.hero =< lib.base\nlib.hero.data = siteSettings:site.title\nlib.hero.wrap = <h1>|</h1>\n');
  await write(path.join(main, 'settings.yaml'), 'site.title: Website set\n');
  await write(path.join(unused, 'config.yaml'), 'name: acme/unused\nlabel: Unused\n');
  await write(path.join(unused, 'settings.yaml'), 'unused.setting: Hidden\n');
  await write(path.join(unused, 'constants.typoscript'), 'unused.constant = Hidden\n');
  await write(path.join(site, 'config.yaml'), 'websiteTitle: Main website\ndependencies:\n  - acme/website\nsettings:\n  site.title: Inline title is replaced\n');
  await write(path.join(site, 'settings.yaml'), 'imports:\n  - resource: common.yaml\nsite.title: Main website\nsite.mode: dark # choose a theme\nsite.enabled: false\n');
  await write(path.join(site, 'common.yaml'), 'site.subtitle: Imported subtitle\n');
  await write(path.join(site, 'setup.typoscript'), 'lib.local = TEXT\nlib.local.value = {siteSettings:site.title}\n');
  const sourceText = 'page = PAGE\npage.10 =< lib.hero\npage.20 = TEXT\npage.20.data = siteSettings:site.title\npage.30.value = {$site.title}\npage.40.value = {$site.subtitle}\npage.50.value = {$site.features}\npage.60 =< lib.local\npage.70.value (\n  <h1>{siteSettings:site.title}</h1>\n)\n';
  const sourceFile = path.join(root, 'setup.typoscript'); await write(sourceFile, sourceText);
  const sourceUri = vscode.Uri.file(sourceFile); await open(sourceFile);
  await vscode.window.showTextDocument(current(sourceUri)); await api.refresh(); await api.whenIdle();
  let document = current(sourceUri);
  let context = await api.getSiteContext(document);
  assert.equal(context.site.id, 'main'); assert.deepEqual(context.sets.map((set) => set.name), ['acme/base', 'acme/website']);
  const objectDefinitions = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', sourceUri, position(document, 'lib.hero'));
  assert.ok(objectDefinitions.some((entry) => entry.uri.path === main + '/setup.typoscript'));
  const localDefinitions = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', sourceUri, position(document, 'lib.local'));
  assert.ok(localDefinitions.some((entry) => entry.uri.path === site + '/setup.typoscript'));
  const setDocument = await open(path.join(main, 'setup.typoscript'));
  const copiedDefinitions = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', setDocument.uri, position(setDocument, 'lib.base'));
  assert.ok(copiedDefinitions.some((entry) => entry.uri.path === base + '/setup.typoscript'));
  const getter = position(document, 'site.title');
  const definitions = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', sourceUri, getter);
  assert.ok(definitions.some((entry) => entry.uri.path === site + '/settings.yaml'));
  assert.ok(definitions.some((entry) => entry.uri.path === base + '/settings.definitions.yaml'));
  const completions = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', sourceUri, position(document, 'site.title', 'site.'.length));
  assert.ok(completions.items.some((entry) => entry.label === 'site.title' && !entry.insertText.endsWith('}')));
  assert.ok(!completions.items.some((entry) => entry.label.startsWith('unused.')));
  const hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', sourceUri, getter);
  assert.ok(hovers.some((hover) => hover.contents.some((content) => /Selected[\s\S]*Main website/.test(content.value || ''))), JSON.stringify(hovers));
  const importedDefinitions = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', sourceUri, position(document, 'site.subtitle'));
  assert.ok(importedDefinitions.some((entry) => entry.uri.path === site + '/common.yaml'));
  console.log('PASS: native site closure, implicit setup navigation, direct getters, imported settings and typed list defaults');

  const mainConfig = await open(path.join(main, 'config.yaml'));
  const namedDefinitions = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', mainConfig.uri, position(mainConfig, 'acme/base'));
  assert.ok(namedDefinitions.some((entry) => entry.uri.path === base + '/config.yaml'));
  const setCompletions = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', mainConfig.uri, position(mainConfig, 'acme/base', 'acme/'.length));
  assert.ok(setCompletions.items.some((entry) => entry.label === 'acme/base'));
  const configBeforeCompletion = mainConfig.getText();
  await applyCompletion(mainConfig, setCompletions.items.find((entry) => entry.label === 'acme/base'));
  assert.equal(mainConfig.getText(), configBeforeCompletion, 'Dependency completion replaces the complete existing name');
  const yamlLinks = await vscode.commands.executeCommand('vscode.executeLinkProvider', mainConfig.uri);
  assert.ok(yamlLinks.some((entry) => entry.target?.path === base + '/config.yaml'));
  const siteSettings = await open(path.join(site, 'settings.yaml'));
  const valueCompletions = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', siteSettings.uri, position(siteSettings, 'dark', 0));
  assert.ok(valueCompletions.items.some((entry) => entry.label === '"light"'));
  const settingsBeforeCompletion = siteSettings.getText();
  await applyCompletion(siteSettings, valueCompletions.items.find((entry) => entry.label === '"light"'));
  assert.ok(siteSettings.getText().includes('site.mode: "light" # choose a theme'), 'Value completion preserves the trailing comment');
  await replace(siteSettings, settingsBeforeCompletion);
  const keyCompletions = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', siteSettings.uri, position(siteSettings, 'site.mode', 'site.'.length));
  await applyCompletion(siteSettings, keyCompletions.items.find((entry) => entry.label === 'site.mode'));
  assert.equal(siteSettings.getText(), settingsBeforeCompletion, 'Key completion preserves the existing value and colon');
  const settingDefinitions = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', siteSettings.uri, position(siteSettings, 'site.mode'));
  assert.ok(settingDefinitions.some((entry) => entry.uri.path === base + '/settings.definitions.yaml'));
  const settingRefs = await vscode.commands.executeCommand('vscode.executeReferenceProvider', siteSettings.uri, position(siteSettings, 'site.title'));
  assert.ok(settingRefs.some((entry) => entry.uri.path === sourceFile && entry.range.start.line === 3));
  assert.ok(settingRefs.some((entry) => entry.uri.path === sourceFile && entry.range.start.line === 9));
  console.log('PASS: native YAML dependency completion, F12, links, enum values and setting references');

  await replace(siteSettings, siteSettings.getText().replace('site.mode: dark', 'site.mode: invalid'));
  await api.whenIdle();
  assert.ok(vscode.languages.getDiagnostics(siteSettings.uri).some((entry) => entry.code === 'setting-value'));
  await replace(siteSettings, siteSettings.getText().replace('site.mode: invalid', 'site.mode: light').replace('Main website', 'Unsaved site title'));
  await api.whenIdle();
  const updated = await vscode.commands.executeCommand('vscode.executeHoverProvider', sourceUri, getter);
  assert.ok(updated.some((hover) => hover.contents.some((content) => (content.value || '').includes('Unsaved site title'))));
  const badConfig = mainConfig.getText() + '  - acme/also-optional\n';
  await replace(mainConfig, badConfig.replace('  - acme/base', '  - acme/missing'));
  await api.whenIdle();
  assert.ok(vscode.languages.getDiagnostics(mainConfig.uri).some((entry) => entry.code === 'missing-set'));
  await replace(mainConfig, badConfig); await api.whenIdle();
  assert.ok(!vscode.languages.getDiagnostics(mainConfig.uri).some((entry) => entry.code === 'missing-set'));
  console.log('PASS: live YAML type/dependency diagnostics and unsaved source invalidation');

  const second = path.join(root, 'config/sites/second');
  await write(path.join(second, 'config.yaml'), 'websiteTitle: Second website\ndependencies: [acme/website]\n');
  await write(path.join(second, 'settings.yaml'), 'site.title: Second website\n');
  await api.refresh(); await api.whenIdle();
  assert.equal((await api.getSiteContext(current(sourceUri))).kind, 'ambiguous');
  await api.selectSiteContext(current(sourceUri), vscode.Uri.file(second)); await api.whenIdle();
  const secondHover = await vscode.commands.executeCommand('vscode.executeHoverProvider', sourceUri, getter);
  assert.ok(secondHover.some((hover) => hover.contents.some((content) => (content.value || '').includes('Second website'))));
  assert.equal((await api.getSiteContext(siteSettings)).site.id, 'main');
  await api.selectSiteContext(current(sourceUri)); await api.whenIdle();
  await fs.rm(second, { recursive: true }); await api.refresh(); await api.whenIdle();
  console.log('PASS: native multi-site isolation, persisted selection and physical-site precedence');

  const classic = path.join(process.env.TYPOSCRIPT_TEST_DIRECTORY, 'v13', 'site-sets-classic');
  const classicExtension = path.join(classic, 'www/typo3conf/ext/classic_set');
  const linkedSource = path.join(classic, 'extension-source');
  await write(path.join(classic, 'www/typo3/sysext/core/Classes/Information/Typo3Version.php'), "<?php class Typo3Version { protected const VERSION = '13.4.0'; }");
  await write(path.join(linkedSource, 'Configuration/Sets/Main/config.yaml'), 'name: acme/classic\nlabel: Classic site\n');
  await write(path.join(linkedSource, 'Configuration/Sets/Main/setup.typoscript'), 'lib.classic = TEXT\n');
  await fs.mkdir(path.dirname(classicExtension), { recursive: true }); await fs.symlink(linkedSource, classicExtension, 'dir');
  await write(path.join(classic, 'www/typo3conf/sites/main/config.yaml'), 'dependencies: [acme/classic]\n');
  await write(path.join(classic, 'www/setup.typoscript'), 'page.10 =< lib.classic\n');
  const classicDoc = await open(path.join(classic, 'www/setup.typoscript'));
  await api.refresh(); await api.whenIdle();
  const classicContext = await api.getSiteContext(current(classicDoc.uri));
  assert.deepEqual(classicContext.sets.map((entry) => entry.name), ['acme/classic']);
  const classicDefinitions = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', classicDoc.uri, position(classicDoc, 'lib.classic'));
  assert.ok(classicDefinitions.some((entry) => entry.uri.path.includes('/classic_set/Configuration/Sets/Main/setup.typoscript')));
  console.log('PASS: native Classic site sets through a symlinked extension without Composer');

  if (capture) {
    await replace(siteSettings, siteSettings.getText().replace('Unsaved site title', 'Main website'));
    await siteSettings.save(); await mainConfig.save();
    await vscode.window.showTextDocument(mainConfig); await api.whenIdle();
    const menu = vscode.commands.executeCommand('typoscriptHighlighting.showSiteSets');
    await capture('site sets in dependency load order', { screenshot: 'site-sets-load-order.png', editorScreenshot: true });
    await vscode.commands.executeCommand('workbench.action.closeQuickOpen'); await menu;
    await vscode.window.showTextDocument(await open(path.join(base, 'settings.definitions.yaml')), { viewColumn: vscode.ViewColumn.Two, preview: false });
    await vscode.window.showTextDocument(siteSettings, { viewColumn: vscode.ViewColumn.One, preview: false }); await api.whenIdle();
    const selection = new vscode.Selection(position(siteSettings, 'site.title', 0), position(siteSettings, 'site.title', 'site.title'.length));
    vscode.window.activeTextEditor.selection = selection;
    await vscode.commands.executeCommand('editor.action.showHover');
    await capture('typed site settings with defaults and source history', { screenshot: 'site-sets-settings.png', editorScreenshot: true });
    await vscode.commands.executeCommand('closeReferenceSearch');
    await vscode.commands.executeCommand('editor.action.hideHover');
  }
  await siteSettings.save(); await mainConfig.save();
}
module.exports = { run };
