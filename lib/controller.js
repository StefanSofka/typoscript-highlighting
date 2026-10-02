const { createVersionDetector } = require('./version');

const LANGUAGE_IDS = new Set(['typoscript', 'typoscript-v11', 'typoscript-v12']);

function createController(vscode, report = () => {}) {
  const subscriptions = [];
  const watchers = new Map();
  const managed = new Map();
  const pinned = new Map();
  const switching = new Set();
  const pending = new Map();
  let disposed = false;

  function watchDirectory(uri) {
    const key = uri.toString();
    if (disposed || watchers.has(key)) return;
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(uri, 'composer.{json,lock}'));
    watchers.set(key, watcher);
    for (const event of ['onDidCreate', 'onDidChange', 'onDidDelete']) {
      subscriptions.push(watcher[event](() => {
        detector.clear();
        void refresh();
      }));
    }
  }
  const detector = createVersionDetector(vscode, watchDirectory, report);

  async function update(document, key, job) {
    if (disposed || document.isClosed || !LANGUAGE_IDS.has(document.languageId)) return;
    const mode = vscode.workspace.getConfiguration('typoscriptHighlighting', document.uri).get('commentRules', 'auto');
    if (!managed.has(key) && document.languageId !== 'typoscript' && !pinned.has(key)) {
      pinned.set(key, document.languageId);
    }
    let target;
    if (mode === 'v11' || mode === 'v12') target = `typoscript-${mode}`;
    else if (pinned.has(key)) target = pinned.get(key);
    else target = (await detector.detect(document)) === 11 ? 'typoscript-v11' : 'typoscript-v12';
    if (disposed || document.isClosed || pending.get(key) !== job || !LANGUAGE_IDS.has(document.languageId)) return;
    if (document.languageId === target) return;
    switching.add(key);
    try {
      await vscode.languages.setTextDocumentLanguage(document, target);
      managed.set(key, target);
    } finally {
      switching.delete(key);
    }
  }

  function enqueue(document) {
    if (disposed || !LANGUAGE_IDS.has(document.languageId)) return Promise.resolve();
    const key = document.uri.toString();
    const previous = pending.get(key)?.promise || Promise.resolve();
    const job = {};
    pending.set(key, job);
    job.promise = previous.then(() => update(document, key, job)).catch(report).finally(() => {
      if (pending.get(key) === job) pending.delete(key);
    });
    return job.promise;
  }

  function refresh() {
    return Promise.all(vscode.workspace.textDocuments.map(enqueue));
  }

  subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      if (!switching.has(document.uri.toString())) void enqueue(document);
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      const key = document.uri.toString();
      if (!switching.has(key)) {
        managed.delete(key);
        pinned.delete(key);
        pending.delete(key);
      }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('typoscriptHighlighting.commentRules')) void refresh();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      detector.clear();
      void refresh();
    })
  );

  return {
    refresh,
    async whenIdle() {
      while (pending.size) await Promise.all([...pending.values()].map((job) => job.promise));
    },
    dispose() {
      disposed = true;
      subscriptions.forEach((subscription) => subscription.dispose());
      watchers.forEach((watcher) => watcher.dispose());
      watchers.clear();
      detector.clear();
      managed.clear();
      pinned.clear();
    }
  };
}

module.exports = { createController };
