const { TOKEN_CATEGORIES, createTokenizer } = require('./tokenizer');

const LANGUAGE_IDS = new Set(['typoscript', 'typoscript-v11', 'typoscript-v12']);

function readColors(vscode, uri) {
  const configuration = vscode.workspace.getConfiguration('typoscriptHighlighting', uri);
  const customColors = configuration.get('customColors', {});
  const colors = {};
  for (const category of Object.keys(TOKEN_CATEGORIES)) {
    const selection = configuration.get(`colors.${category}`, '');
    // Keep 1.2.0 Custom selections working; new selections store hex directly.
    const value = selection === 'custom' ? customColors?.[category] : selection;
    if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) colors[category] = value.toUpperCase();
  }
  return colors;
}

function createColorController(vscode, report = () => {}, loadTokenizer = createTokenizer) {
  const styles = new Map();
  const cache = new Map();
  const jobs = new WeakMap();
  const pending = new Set();
  const timers = new Map();
  let tokenizerPromise;
  let disposed = false;

  function clear(editor) {
    for (const style of styles.values()) editor.setDecorations(style, []);
  }

  async function update(editor) {
    const job = {};
    jobs.set(editor, job);
    const document = editor.document;
    if (disposed) return;
    clear(editor);
    if (document.isClosed || !LANGUAGE_IDS.has(document.languageId)) return;
    const colors = readColors(vscode, document.uri);
    if (!Object.keys(colors).length) return;
    const version = document.version;
    const language = document.languageId;
    const key = document.uri.toString();
    let entry = cache.get(key);
    if (!entry || entry.version !== version || entry.language !== language) {
      const text = document.getText();
      if (!tokenizerPromise) tokenizerPromise = Promise.resolve().then(loadTokenizer)
        .catch((error) => { tokenizerPromise = undefined; throw error; });
      const tokenizer = await tokenizerPromise;
      if (disposed || jobs.get(editor) !== job || document.isClosed || editor.document !== document
        || document.version !== version || document.languageId !== language
        || !vscode.window.visibleTextEditors.includes(editor)) return;
      entry = { version, language, ranges: tokenizer.tokenize(language, text) };
      cache.set(key, entry);
    }
    const grouped = new Map();
    for (const token of entry.ranges) {
      const color = colors[token.category];
      if (!color) continue;
      if (!grouped.has(color)) grouped.set(color, []);
      grouped.get(color).push(new vscode.Range(token.line, token.start, token.line, token.end));
    }
    for (const [color, ranges] of grouped) {
      if (!styles.has(color)) styles.set(color, vscode.window.createTextEditorDecorationType({ color,
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed }));
      editor.setDecorations(styles.get(color), ranges);
    }
  }

  function enqueue(editor) {
    const promise = update(editor).catch(report).finally(() => pending.delete(promise));
    pending.add(promise);
    return promise;
  }

  function refresh() {
    if (disposed) return Promise.resolve();
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    return Promise.all(vscode.window.visibleTextEditors.map(enqueue));
  }

  const subscriptions = [
    vscode.window.onDidChangeVisibleTextEditors(() => { void refresh(); }),
    vscode.workspace.onDidOpenTextDocument(() => { void refresh(); }),
    vscode.workspace.onDidCloseTextDocument((document) => { cache.delete(document.uri.toString()); }),
    vscode.workspace.onDidChangeTextDocument(({ document }) => {
      if (!LANGUAGE_IDS.has(document.languageId)) return;
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document !== document) continue;
        if (!styles.size && !Object.keys(readColors(vscode, document.uri)).length) continue;
        // Invalidate pending initial tokenization immediately, before the debounce.
        jobs.set(editor, {});
        if (timers.has(editor)) clearTimeout(timers.get(editor));
        timers.set(editor, setTimeout(() => {
          timers.delete(editor);
          void enqueue(editor);
        }, 75));
      }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('typoscriptHighlighting.colors')
        && !event.affectsConfiguration('typoscriptHighlighting.customColors')) return;
      for (const style of styles.values()) style.dispose();
      styles.clear();
      void refresh();
    })
  ];

  return {
    refresh,
    async whenIdle() {
      while (timers.size || pending.size) {
        if (pending.size) await Promise.all([...pending]);
        else await new Promise((resolve) => setTimeout(resolve, 10));
      }
    },
    dispose() {
      disposed = true;
      subscriptions.forEach((subscription) => subscription.dispose());
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      for (const style of styles.values()) style.dispose();
      styles.clear();
      cache.clear();
      if (tokenizerPromise) void tokenizerPromise.then((tokenizer) => tokenizer.dispose(), () => {});
    }
  };
}

module.exports = { readColors, createColorController };
