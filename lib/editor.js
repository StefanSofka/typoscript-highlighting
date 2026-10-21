const { isTypoScript } = require('./language');
const SHARED_LANGUAGE = '[typoscript][typoscript-v11][typoscript-v12]';

function describeVersion(info = {}) {
  const family = info.languageId === 'typoscript-v11' ? 'Legacy comment rules (TYPO3 11)' : 'Modern comment rules (TYPO3 12+)';
  if (info.source === 'lock') return { text: `TYPO3 ${info.version} · Auto`, detail: `Installed version from composer.lock.\n${family}.\n${info.sourceUri.path}` };
  if (info.source === 'manifest') return { text: info.major ? `TYPO3 ${info.constraint} · Range` : 'TypoScript · Fallback',
    detail: `Composer requirement: ${info.constraint || 'unknown'}. This is a version range, not an installed version.\n${family}.${info.major ? '' : '\nThe version range is ambiguous; modern rules are the fallback.'}\n${info.sourceUri.path}` };
  if (info.source === 'setting') return { text: `TYPO3 ${info.major} · Setting`, detail: `Explicit TYPO3 target version.\n${family}.` };
  if (info.source === 'manual') return { text: info.major === 11 ? 'TypoScript 11 · Pinned' : 'TypoScript 12+ · Pinned', detail: `Language mode selected manually.\n${family}. Choose Auto to resume Composer detection.` };
  if (info.source === 'unknown-lock') return { text: 'TypoScript · Fallback', detail: `The locked TYPO3 version (${info.version || 'unknown'}) could not be classified.\n${family} are used as the fallback.\n${info.sourceUri.path}` };
  return { text: 'TypoScript · Fallback', detail: `No supported TYPO3 version was detected.\n${family} are used as the fallback.` };
}

function createEditorTools(vscode, controller, report = () => {}) {
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 20);
  status.name = 'TypoScript TYPO3 version';
  status.command = 'typoscriptHighlighting.showVersion';
  function update() {
    const document = vscode.window.activeTextEditor?.document;
    if (!isTypoScript(document)) { status.hide(); return; }
    const description = describeVersion(controller.getInfo(document));
    status.text = `$(symbol-property) ${description.text}`;
    status.tooltip = `${description.detail}\nClick to change target version or inspect detection.`;
    status.show();
  }
  async function showVersion() {
    const document = vscode.window.activeTextEditor?.document;
    if (!isTypoScript(document)) return;
    const info = controller.getInfo(document);
    const options = [
      { label: 'Auto', description: 'Detect from Composer; remove the manual language pin', version: 'auto' },
      ...[11, 12, 13, 14].map((major) => ({ label: `TYPO3 ${major}`, description: 'Set the target version for this folder', version: `v${major}` })),
      ...(info?.sourceUri ? [{ label: 'Open Composer source', description: info.sourceUri.path, action: 'source' }] : []),
      { label: 'Re-detect project', description: 'Clear cached Composer metadata; explicit settings keep precedence', action: 'refresh' },
      { label: 'Configure shared language settings', description: 'Use the same editor settings in all TypoScript modes', action: 'settings' }
    ];
    const selected = await vscode.window.showQuickPick(options, { title: describeVersion(info).text, placeHolder: 'TYPO3 target version and detection' });
    if (!selected) return;
    if (selected.action === 'source') return vscode.window.showTextDocument(await vscode.workspace.openTextDocument(info.sourceUri));
    if (selected.action === 'settings') return configureLanguageSettings();
    if (selected.action === 'refresh') {
      if (document.languageId !== 'typoscript') await vscode.languages.setTextDocumentLanguage(document, 'typoscript');
      return controller.redetect();
    }
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    await vscode.workspace.getConfiguration('typoscriptHighlighting', document.uri)
      .update('typo3Version', selected.version, folder ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Global);
    await controller.whenIdle();
    const current = vscode.workspace.textDocuments.find((entry) => entry.uri.toString() === document.uri.toString());
    if (selected.version === 'auto' && current && current.languageId !== 'typoscript') await vscode.languages.setTextDocumentLanguage(current, 'typoscript');
    await controller.refresh();
  }
  async function configureLanguageSettings() {
    const document = vscode.window.activeTextEditor?.document;
    const folder = document && vscode.workspace.getWorkspaceFolder(document.uri);
    const choices = [{ label: 'User', target: vscode.ConfigurationTarget.Global, property: 'globalValue' },
      ...(vscode.workspace.workspaceFolders?.length ? [{ label: 'Workspace', target: vscode.ConfigurationTarget.Workspace, property: 'workspaceValue' }] : []),
      ...(folder ? [{ label: `Folder: ${folder.name}`, target: vscode.ConfigurationTarget.WorkspaceFolder, property: 'workspaceFolderValue' }] : [])];
    const choice = await vscode.window.showQuickPick(choices, { title: 'Shared TypoScript editor settings', placeHolder: 'Copy existing [typoscript] settings to all three language modes' });
    if (!choice) return;
    const config = vscode.workspace.getConfiguration(undefined, document?.uri);
    const source = config.inspect('[typoscript]')?.[choice.property] || {};
    const shared = config.inspect(SHARED_LANGUAGE)?.[choice.property] || {};
    await config.update(SHARED_LANGUAGE, { ...shared, ...source }, choice.target);
    await vscode.window.showInformationMessage(`Shared TypoScript settings saved in ${choice.label}.`, 'Open Settings JSON').then((action) => {
      if (action) return vscode.commands.executeCommand(choice.target === vscode.ConfigurationTarget.Global ? 'workbench.action.openSettingsJson' : 'workbench.action.openWorkspaceSettingsFile');
    });
  }
  const handle = (action) => (...args) => Promise.resolve(action(...args)).catch(report);
  const subscriptions = [status, controller.onDidResolve(update), vscode.window.onDidChangeActiveTextEditor(update),
    vscode.commands.registerCommand('typoscriptHighlighting.showVersion', handle(showVersion)),
    vscode.commands.registerCommand('typoscriptHighlighting.configureLanguageSettings', handle(configureLanguageSettings))];
  update();
  return { dispose() { subscriptions.forEach((item) => item.dispose()); } };
}

module.exports = { describeVersion, SHARED_LANGUAGE, createEditorTools };
