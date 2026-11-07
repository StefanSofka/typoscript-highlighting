const { CATEGORIES, getColors, getSkin, customColors, inspectedSetting, themePalette } = require('./palette');
const { resolveSkin, THEME_OPTIONS } = require('./skins');
const { isTypoScript } = require('./language');
const { getSettings, OBJECT_SETTINGS } = require('./settings');
const { themeHtml } = require('./color-settings-view');

const COMMAND = 'typoscriptHighlighting.configureColors';
const EDIT_COMMAND = 'typoscriptHighlighting.editCustomTheme';

function createColorSettings(vscode, extensionUri, report = () => {}) {
  let session;
  let pending = Promise.resolve();
  let disposed = false;
  let lastResource = isTypoScript(vscode.window.activeTextEditor?.document) ? vscode.window.activeTextEditor.document.uri : undefined;

  function destination() {
    const folder = lastResource && vscode.workspace.getWorkspaceFolder(lastResource);
    const config = getSettings(vscode, lastResource);
    // Continue editing an existing project choice; otherwise custom colors are personal.
    for (const [id, property, target, label] of [
      ...(folder ? [[`folder:${folder.uri.toString()}`, 'workspaceFolderValue', vscode.ConfigurationTarget.WorkspaceFolder, `Project: ${folder.name}`]] : []),
      ['workspace', 'workspaceValue', vscode.ConfigurationTarget.Workspace, 'Workspace settings']
    ]) {
      if (['theme', 'skin', ...OBJECT_SETTINGS, ...CATEGORIES.map(([category]) => `colors.${category}`)]
        .some((key) => config.inspect(key)?.[property] !== undefined)) {
        return { id, uri: lastResource, target, label };
      }
    }
    return { id: 'user', target: vscode.ConfigurationTarget.Global, label: 'User settings' };
  }
  async function post(owner, message) {
    if (disposed || owner.closed) return;
    try { await owner.panel.webview.postMessage(message); }
    catch (error) { if (!owner.closed && !disposed && !/^Unknown webview handle:/.test(error.message || '')) report(error); }
  }
  function state(owner, category) {
    const configuration = getSettings(vscode, owner.target.uri);
    const choice = inspectedSetting(configuration, 'theme', owner.target.id);
    const selected = choice.source === 'defaultValue' ? getSkin(vscode, owner.target).selected : choice.value;
    void post(owner, { type: 'state', colors: customColors(vscode, owner.target), location: owner.target.label, category,
      theme: THEME_OPTIONS.some(({ id }) => id === selected) ? selected : 'auto',
      themes: THEME_OPTIONS.map(({ id, label }) => ({ id, label, colors: id === 'custom' ? {} : resolveSkin(id, themePalette(vscode)).colors })) });
  }
  function enqueue(owner, message, write) {
    const operation = message.type;
    pending = pending.then(async () => {
      if (disposed) return;
      await write(getSettings(vscode, owner.target.uri));
      await post(owner, { type: 'saved', operation, id: message.id });
      state(owner);
    }).catch((error) => {
      report(error);
      const action = operation === 'theme' ? 'apply' : 'save';
      void post(owner, { type: 'error', operation, id: message.id, message: `Unable to ${action} theme: ${error.message || error}` });
      if (operation === 'theme') state(owner);
    });
  }
  function receive(owner, message) {
    if (disposed || owner.closed || !message || typeof message !== 'object') return;
    if (message.type === 'ready') return state(owner, owner.category);
    if (message.type === 'theme' && Number.isSafeInteger(message.id)
      && THEME_OPTIONS.some(({ id }) => id !== 'custom' && id === message.theme)) {
      enqueue(owner, message, (configuration) => configuration.update('theme', message.theme, owner.target.target));
      return;
    }
    if (message.type !== 'save' || !Number.isSafeInteger(message.id) || !message.colors || typeof message.colors !== 'object') return;
    const entries = Object.entries(message.colors);
    if (entries.length !== CATEGORIES.length || !CATEGORIES.every(([category]) => Object.hasOwn(message.colors, category)
      && typeof message.colors[category] === 'string' && /^#[0-9a-f]{6}$/i.test(message.colors[category]))) return;
    const values = Object.fromEntries(entries.map(([key, value]) => [key, value.toUpperCase()]));
    enqueue(owner, message, async (configuration) => {
      await configuration.update('colors', values, owner.target.target);
      await configuration.update('theme', 'custom', owner.target.target);
    });
  }
  function open(category) {
    if (disposed) return;
    category = CATEGORIES.some(([key]) => key === category) ? category : undefined;
    if (session) { session.panel.reveal(session.panel.viewColumn); session.category = category; state(session, category); return; }
    const panel = vscode.window.createWebviewPanel('typoscriptCustomTheme', 'TypoScript: Theme',
      vscode.ViewColumn.Active || vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')] });
    const owner = { panel, target: destination(), category, closed: false };
    session = owner;
    const listener = panel.webview.onDidReceiveMessage((message) => receive(owner, message));
    const closed = panel.onDidDispose(() => {
      owner.closed = true; listener.dispose(); closed.dispose();
      if (session === owner) session = undefined;
    });
    panel.webview.html = themeHtml(vscode, extensionUri, panel.webview);
  }
  const handle = (action) => (...args) => Promise.resolve().then(() => action(...args)).catch(report);
  const subscriptions = [
    vscode.commands.registerCommand(COMMAND, handle(open)),
    vscode.commands.registerCommand(EDIT_COMMAND, open),
    vscode.window.onDidChangeActiveTextEditor((editor) => { if (isTypoScript(editor?.document)) lastResource = editor.document.uri; }),
    vscode.workspace.onDidChangeConfiguration((event) => { if (session && event.affectsConfiguration('typoscriptHighlighting')) state(session); })
  ];
  if (vscode.window.onDidChangeActiveColorTheme) subscriptions.push(vscode.window.onDidChangeActiveColorTheme(() => { if (session) state(session); }));
  return { async whenIdle() { let current; do { current = pending; await current; } while (current !== pending); },
    dispose() { disposed = true; subscriptions.forEach((item) => item.dispose()); session?.panel.dispose(); } };
}

module.exports = { COMMAND, EDIT_COMMAND, CATEGORIES, getColors, customColors, createColorSettings };
