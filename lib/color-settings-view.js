const { randomBytes } = require('node:crypto');

function themeHtml(vscode, extensionUri, webview) {
  const nonce = randomBytes(24).toString('base64');
  const asset = (name) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', name));
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${asset('color-settings.css')}"><title>TypoScript Theme</title></head>
<body><main><header><h1>TypoScript theme</h1><p>Choose a theme, then adjust any color to make it your own.</p></header>
<div class="theme-choice"><label for="theme">Theme</label><select id="theme" disabled></select></div>
<p id="theme-help">Color changes appear in the preview. Save to apply your custom theme.</p>
<div class="layout"><section id="colors" aria-label="Custom syntax colors"></section>
<section class="preview" aria-labelledby="preview-title"><h2 id="preview-title">Preview</h2><pre><code><span data-color="comments"># Your site configuration</span>
<span data-color="imports">@import './constants.typoscript'</span>
<span data-color="conditions">[site("identifier") == "main"]</span>
<span data-color="objectPaths">page</span> <span data-color="operators">=</span> <span data-color="values">PAGE</span>
<span data-color="objectPaths">page.10</span> <span data-color="punctuation">{</span>
  <span data-color="objectPaths">value</span> <span data-color="operators">=</span> <span data-color="values">Hello <span data-color="constants">{$site.name}</span></span>
<span data-color="punctuation">}</span>
<span data-color="objectPaths">value</span> <span data-color="operators">:=</span> <span data-color="functions">addToList</span><span data-color="punctuation">(</span><span data-color="values">example</span><span data-color="punctuation">)</span>
<span data-color="conditions">[END]</span></code></pre></section></div>
<footer><button id="save" disabled>Save custom theme</button><span id="status" role="status" aria-live="polite">Loading…</span></footer>
<p id="location" class="location"></p></main><script nonce="${nonce}" src="${asset('color-settings.js')}"></script></body></html>`;
}

module.exports = { themeHtml };
