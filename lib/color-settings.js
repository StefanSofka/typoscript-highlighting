const { randomBytes } = require('node:crypto');
const { TOKEN_CATEGORIES } = require('./tokenizer');

const COMMAND = 'typoscriptHighlighting.configureColors';
const CATEGORIES = [
  ['comments', 'Comments', 'Line, block and documentation comments'],
  ['objectPaths', 'Object paths', 'Paths and copy/reference targets'],
  ['values', 'Values', 'Assignment values and quoted strings'],
  ['operators', 'Operators', 'Assignment, copy, modification and deletion'],
  ['constants', 'Constants', 'References such as {$site.name}'],
  ['conditions', 'Conditions', 'Conditions and END / GLOBAL / ELSE'],
  ['imports', 'Imports', 'Import keywords, paths and attributes'],
  ['functions', 'Functions', 'Value modifiers such as addToList'],
  ['punctuation', 'Punctuation', 'Braces, parentheses and closing brackets']
];

function scopeValue(configuration, key, target) {
  const values = configuration.inspect(key) || {};
  const layers = [values.defaultValue, values.globalValue];
  if (target !== 'user') layers.push(values.workspaceValue);
  if (target.startsWith('folder:')) layers.push(values.workspaceFolderValue);
  if (key === 'customColors') return Object.assign({}, ...layers);
  return layers.filter((value) => value !== undefined).at(-1);
}

function getColors(vscode, target) {
  const configuration = vscode.workspace.getConfiguration('typoscriptHighlighting', target.uri);
  const legacy = scopeValue(configuration, 'customColors', target.id);
  return CATEGORIES.map(([category, label, description]) => {
    const selection = scopeValue(configuration, `colors.${category}`, target.id);
    const value = selection === 'custom' ? legacy[category] : selection;
    return { category, label, description,
      color: typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : '' };
  });
}

function html(vscode, extensionUri, webview) {
  const nonce = randomBytes(24).toString('base64');
  const asset = (name) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', name));
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${asset('color-settings.css')}">
<title>TypoScript Colors</title></head><body>
<main>
  <header><h1>TypoScript Colors</h1><p>Choose a color from the spectrum or enter a hex code. System Default follows your editor theme.</p></header>
  <div class="toolbar"><label for="scope">Save colors in</label><select id="scope" aria-label="Settings scope"></select><span id="status" role="status" aria-live="polite">Loading…</span></div>
  <div class="layout">
    <section id="categories" aria-label="Syntax colors"></section>
    <section class="picker" aria-labelledby="picker-title">
      <h2 id="picker-title">Comments</h2><p id="picker-help">Select a category to edit its color.</p>
      <div id="spectrum" class="spectrum" tabindex="0" role="slider" aria-label="Saturation and brightness" aria-valuemin="0" aria-valuemax="100"><span id="marker"></span></div>
      <label class="hue-label" for="hue">Hue</label><input id="hue" type="range" min="0" max="360" step="1" value="0" aria-label="Hue">
      <p class="keyboard-help">Spectrum: arrow keys adjust saturation and brightness. Hold Shift for larger steps.</p>
      <div class="selected-color"><span id="preview" aria-hidden="true"></span><code id="color-value">System Default</code></div>
    </section>
  </div>
</main><script nonce="${nonce}" src="${asset('color-settings.js')}"></script></body></html>`;
}

function createColorSettings(vscode, extensionUri, report = () => {}) {
  let panel;
  let session;
  let pending = Promise.resolve();
  let disposed = false;
  let lastResource = vscode.window.activeTextEditor?.document.uri;
  const targets = () => [
    { id: 'user', label: 'User', target: vscode.ConfigurationTarget.Global },
    ...(vscode.workspace.workspaceFolders?.length ? [
      { id: 'workspace', label: 'Workspace', target: vscode.ConfigurationTarget.Workspace },
      ...vscode.workspace.workspaceFolders.map((folder) => ({ id: `folder:${folder.uri.toString()}`,
        label: `Folder: ${folder.name}`, uri: folder.uri, target: vscode.ConfigurationTarget.WorkspaceFolder }))
    ] : [])
  ];

  function postState(owner, category) {
    if (disposed || owner.closed) return;
    const choices = targets();
    owner.target = choices.find((target) => target.id === owner.target.id) || choices[0];
    void owner.panel.webview.postMessage({ type: 'state', targetId: owner.target.id,
      targets: choices.map(({ id, label }) => ({ id, label })), colors: getColors(vscode, owner.target), category });
  }

  function receive(owner, message) {
    if (disposed || owner.closed || !message || typeof message !== 'object') return;
    if (message.type === 'ready') return postState(owner, owner.category);
    if (message.type === 'target') {
      const target = targets().find((entry) => entry.id === message.targetId);
      if (target) { owner.target = target; postState(owner); }
      return;
    }
    if (message.type !== 'color' || !Object.hasOwn(TOKEN_CATEGORIES, message.category)
      || typeof message.color !== 'string' || !/^(?:#[0-9a-f]{6})?$/i.test(message.color)
      || !Number.isSafeInteger(message.id)) return;
    const target = owner.target;
    const color = message.color.toUpperCase();
    // Serialize writes so quick edits to different categories cannot lose settings.
    pending = pending.then(async () => {
      if (disposed) return;
      await vscode.workspace.getConfiguration('typoscriptHighlighting', target.uri)
        .update(`colors.${message.category}`, color, target.target);
      if (!owner.closed) {
        await owner.panel.webview.postMessage({ type: 'saved', id: message.id, targetId: target.id,
          category: message.category, color });
        postState(owner);
      }
    }).catch((error) => {
      report(error);
      if (!owner.closed) void owner.panel.webview.postMessage({ type: 'error', id: message.id,
        targetId: target.id, category: message.category, message: `Unable to save color: ${error.message || error}` });
    });
  }

  function open(category) {
    if (disposed) return;
    if (panel) {
      panel.reveal(panel.viewColumn);
      session.category = Object.hasOwn(TOKEN_CATEGORIES, category) ? category : session.category;
      postState(session, session.category);
      return;
    }
    const choices = targets();
    const folder = lastResource && vscode.workspace.getWorkspaceFolder(lastResource);
    const target = choices.find((entry) => entry.uri?.toString() === folder?.uri.toString()) || choices[0];
    panel = vscode.window.createWebviewPanel('typoscriptColors', 'TypoScript Colors',
      vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')] });
    const owner = { panel, target, category: Object.hasOwn(TOKEN_CATEGORIES, category) ? category : 'comments', closed: false };
    session = owner;
    const listener = panel.webview.onDidReceiveMessage((message) => receive(owner, message));
    const closed = panel.onDidDispose(() => {
      owner.closed = true;
      listener.dispose();
      closed.dispose();
      if (panel === owner.panel) { panel = undefined; session = undefined; }
    });
    panel.webview.html = html(vscode, extensionUri, panel.webview);
  }

  const subscriptions = [
    vscode.commands.registerCommand(COMMAND, open),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && ['typoscript', 'typoscript-v11', 'typoscript-v12'].includes(editor.document.languageId)) {
        lastResource = editor.document.uri;
      }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (session && (event.affectsConfiguration('typoscriptHighlighting.colors')
        || event.affectsConfiguration('typoscriptHighlighting.customColors'))) postState(session);
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => { if (session) postState(session); })
  ];
  return {
    async whenIdle() {
      let current;
      do { current = pending; await current; } while (current !== pending);
    },
    dispose() {
      disposed = true;
      subscriptions.forEach((subscription) => subscription.dispose());
      panel?.dispose();
    }
  };
}

module.exports = { COMMAND, CATEGORIES, getColors, createColorSettings };
