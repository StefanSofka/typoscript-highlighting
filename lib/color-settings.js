const { randomBytes } = require('node:crypto');
const { TOKEN_CATEGORIES } = require('./tokenizer');
const { CATEGORIES, PALETTES, themePalette, paletteKey, targetProperty, getColors } = require('./palette');

const COMMAND = 'typoscriptHighlighting.configureColors';
function html(vscode, extensionUri, webview) {
  const nonce = randomBytes(24).toString('base64');
  const asset = (name) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', name));
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${asset('color-settings.css')}">
<title>TypoScript Colors</title></head><body><main>
<header><h1>TypoScript Colors</h1><p>Choose a color, follow your editor theme, or inherit colors from another settings scope.</p></header>
<div class="toolbar"><label for="scope">Save colors in</label><select id="scope" aria-label="Settings scope"></select>
<label for="palette">Palette</label><select id="palette" aria-label="Color palette"><option value="base">Base · all themes</option><option value="dark">Dark themes</option><option value="light">Light themes</option></select>
<span id="status" role="status" aria-live="polite">Loading…</span></div>
<div class="bulk-actions"><button id="inherit-all" disabled>Inherit all</button><button id="reset-all" disabled>Use editor theme for all</button><button id="undo" disabled>Undo last change</button></div>
<div class="layout"><section id="categories" aria-label="Syntax colors"></section>
<section class="picker" aria-labelledby="picker-title"><h2 id="picker-title">Comments</h2><p id="picker-help">Select a category to edit its color.</p>
<div id="spectrum" class="spectrum" tabindex="0" role="slider" aria-label="Saturation and brightness" aria-valuemin="0" aria-valuemax="100"><span id="marker"></span></div>
<label class="hue-label" for="hue">Hue</label><input id="hue" type="range" min="0" max="360" step="1" value="0" aria-label="Hue">
<p class="keyboard-help">Spectrum: arrow keys adjust saturation and brightness. Hold Shift for larger steps.</p>
<div class="selected-color"><span id="preview" aria-hidden="true"></span><code id="color-value">System Default</code></div>
<p id="contrast" role="status"></p>
<div class="code-preview" aria-label="TypoScript color preview"><pre><code><span data-color="comments"># Your site configuration</span>
<span data-color="imports">@import './constants.typoscript'</span>
<span data-color="conditions">[site("identifier") == "main"]</span>
<span data-color="objectPaths">page</span> <span data-color="operators">=</span> <span data-color="values">PAGE</span>
<span data-color="objectPaths">page.10</span> <span data-color="punctuation">{</span>
  <span data-color="objectPaths">value</span> <span data-color="operators">=</span> <span data-color="values">Hello <span data-color="constants">{$site.name}</span></span>
<span data-color="punctuation">}</span>
<span data-color="objectPaths">value</span> <span data-color="operators">:=</span> <span data-color="functions">addToList</span><span data-color="punctuation">(</span><span data-color="values">example</span><span data-color="punctuation">)</span>
<span data-color="conditions">[END]</span></code></pre></div>
<p class="preview-help">Open TypoScript files show the exact colors from your editor theme.</p>
</section></div></main><script nonce="${nonce}" src="${asset('color-settings.js')}"></script></body></html>`;
}

function createColorSettings(vscode, extensionUri, report = () => {}, storage) {
  let panel, session;
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
  function persist(key, value) { if (storage) void storage.update(key, value).catch(report); }
  function postState(owner, category) {
    if (disposed || owner.closed) return;
    const choices = targets();
    owner.target = choices.find((target) => target.id === owner.target.id) || choices[0];
    void owner.panel.webview.postMessage({ type: 'state', targetId: owner.target.id, palette: owner.palette,
      activePalette: themePalette(vscode), canUndo: !!owner.history.length,
      targets: choices.map(({ id, label }) => ({ id, label })), colors: getColors(vscode, owner.target, owner.palette, lastResource), category });
  }
  function ownValues(target, palette, categories) {
    const config = vscode.workspace.getConfiguration('typoscriptHighlighting', target.uri);
    return Object.fromEntries(categories.map((category) => {
      const value = config.inspect(palette === 'base' ? `colors.${category}` : paletteKey(palette))?.[targetProperty(target.id)];
      return [category, palette === 'base' ? value : value?.[category]];
    }));
  }
  async function writeValues(target, palette, values) {
    // Preserve the exact local object, including independent per-category inheritance.
    const config = vscode.workspace.getConfiguration('typoscriptHighlighting', target.uri);
    if (palette !== 'base') {
      const current = { ...(config.inspect(paletteKey(palette))?.[targetProperty(target.id)] || {}) };
      for (const [category, value] of Object.entries(values)) {
        if (value === undefined) delete current[category]; else current[category] = value;
      }
      await config.update(paletteKey(palette), Object.keys(current).length ? current : undefined, target.target);
    } else for (const [category, value] of Object.entries(values)) await config.update(`colors.${category}`, value, target.target);
  }
  function save(owner, message, values, undo = false) {
    const target = owner.target, palette = owner.palette;
    pending = pending.then(async () => {
      if (disposed) return;
      if (undo) {
        const previous = owner.history.pop();
        if (previous) await writeValues(previous.target, previous.palette, previous.values);
      } else {
        owner.history.push({ target, palette, values: ownValues(target, palette, Object.keys(values)) });
        if (owner.history.length > 50) owner.history.shift();
        await writeValues(target, palette, values);
      }
      if (!owner.closed) {
        await owner.panel.webview.postMessage({ type: 'saved', id: message.id, targetId: target.id, palette,
          category: message.category, color: values?.[message.category] });
        postState(owner);
      }
    }).catch((error) => {
      report(error);
      if (!owner.closed) {
        void owner.panel.webview.postMessage({ type: 'error', id: message.id, targetId: target.id, palette,
          category: message.category, message: `Unable to save color: ${error.message || error}` });
        postState(owner);
      }
    });
  }
  function receive(owner, message) {
    if (disposed || owner.closed || !message || typeof message !== 'object') return;
    if (message.type === 'ready') return postState(owner, owner.category);
    if (message.type === 'target') {
      const target = targets().find((entry) => entry.id === message.targetId);
      if (target) { owner.target = target; persist('colorTarget', target.id); postState(owner); }
      return;
    }
    if (message.type === 'palette') {
      if (PALETTES.includes(message.palette)) { owner.palette = message.palette; persist('colorPalette', owner.palette); postState(owner); }
      return;
    }
    if (!Number.isSafeInteger(message.id)) return;
    if (message.type === 'undo') return save(owner, message, {}, true);
    if (message.type === 'bulk' && ['inherit', 'theme'].includes(message.action)) {
      return save(owner, message, Object.fromEntries(CATEGORIES.map(([category]) => [category, message.action === 'inherit' ? undefined : ''])));
    }
    if (!Object.hasOwn(TOKEN_CATEGORIES, message.category)) return;
    if (message.type === 'inherit') return save(owner, message, { [message.category]: undefined });
    if (message.type === 'color' && typeof message.color === 'string' && /^(?:#[0-9a-f]{6})?$/i.test(message.color)) {
      save(owner, message, { [message.category]: message.color.toUpperCase() });
    }
  }
  function open(category) {
    if (disposed) return;
    if (panel) {
      panel.reveal(panel.viewColumn);
      session.category = Object.hasOwn(TOKEN_CATEGORIES, category) ? category : session.category;
      postState(session, session.category); return;
    }
    const choices = targets();
    const target = choices.find((entry) => entry.id === storage?.get('colorTarget')) || choices[0];
    panel = vscode.window.createWebviewPanel('typoscriptColors', 'TypoScript Colors',
      vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')] });
    const preferred = storage?.get('colorPalette', 'base');
    const owner = { panel, target, palette: PALETTES.includes(preferred) ? preferred : 'base', history: [],
      category: Object.hasOwn(TOKEN_CATEGORIES, category) ? category : 'comments', closed: false };
    session = owner;
    const listener = panel.webview.onDidReceiveMessage((message) => receive(owner, message));
    const closed = panel.onDidDispose(() => {
      owner.closed = true; listener.dispose(); closed.dispose();
      if (panel === owner.panel) { panel = undefined; session = undefined; }
    });
    panel.webview.html = html(vscode, extensionUri, panel.webview);
  }
  const subscriptions = [
    vscode.commands.registerCommand(COMMAND, open),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && ['typoscript', 'typoscript-v11', 'typoscript-v12'].includes(editor.document.languageId)) {
        lastResource = editor.document.uri; if (session) postState(session);
      }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => { if (session && event.affectsConfiguration('typoscriptHighlighting')) postState(session); }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => { if (session) postState(session); })
  ];
  if (vscode.window.onDidChangeActiveColorTheme) subscriptions.push(vscode.window.onDidChangeActiveColorTheme(() => { if (session) postState(session); }));
  return { async whenIdle() { let current; do { current = pending; await current; } while (current !== pending); },
    dispose() { disposed = true; subscriptions.forEach((item) => item.dispose()); panel?.dispose(); } };
}
module.exports = { COMMAND, CATEGORIES, getColors, createColorSettings };
