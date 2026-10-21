const { createVersionDetector } = require('./version');
const { isTypoScript, targetVersion } = require('./language');

function createController(vscode, report = () => {}, storage) {
  const watchers = new Map();
  const dependencies = new Map();
  const managed = new Map();
  const pinned = new Map();
  const switching = new Set();
  const pending = new Map();
  const information = new Map();
  const listeners = new Set();
  const remembered = new Map(storage?.get('documentModes', []) || []);
  let disposed = false;
  let persisted = Promise.resolve();

  function remember(key, languageId, kind, pin) {
    remembered.delete(key);
    remembered.set(key, { languageId, kind, ...(pin ? { pin } : {}) });
    while (remembered.size > 200) remembered.delete(remembered.keys().next().value);
    if (storage) persisted = persisted.then(() => storage.update('documentModes', [...remembered])).catch(report);
  }

  function prune() {
    const used = new Set([...dependencies.values()].flatMap((keys) => [...keys]));
    for (const [key, entry] of watchers) if (!used.has(key)) {
      entry.listeners.forEach((listener) => listener.dispose());
      entry.watcher.dispose();
      watchers.delete(key);
    }
    detector.retain(used);
  }

  function watchDirectory(uri, key) {
    if (disposed) return;
    dependencies.get(key)?.add(uri.toString());
    if (watchers.has(uri.toString())) return;
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(uri, 'composer.{json,lock}'));
    const entry = { watcher, listeners: [] };
    watchers.set(uri.toString(), entry);
    for (const event of ['onDidCreate', 'onDidChange', 'onDidDelete']) {
      entry.listeners.push(watcher[event](() => { detector.clear(); void refresh(); }));
    }
  }
  const detector = createVersionDetector(vscode, () => {}, report);

  async function update(document, key, job) {
    if (disposed || document.isClosed || !isTypoScript(document)) return;
    const mode = targetVersion(vscode.workspace.getConfiguration('typoscriptHighlighting', document.uri));
    const previous = remembered.get(key);
    if (!managed.has(key) && document.languageId !== 'typoscript' && !pinned.has(key)) {
      const restored = previous?.languageId === document.languageId;
      if (restored && previous.kind === 'manual') pinned.set(key, previous.pin || previous.languageId);
      else if (!(restored && previous.kind === 'auto')) pinned.set(key, document.languageId);
    }
    dependencies.set(key, new Set());
    let info;
    let target;
    if (/^v(?:11|12|13|14)$/.test(mode)) {
      target = mode === 'v11' ? 'typoscript-v11' : 'typoscript-v12';
      info = { major: Number(mode.slice(1)), source: 'setting' };
    } else if (pinned.has(key)) {
      target = pinned.get(key);
      info = { major: target === 'typoscript-v11' ? 11 : null, source: 'manual' };
    } else {
      info = await detector.detectInfo(document, (uri) => {
        if (!document.isClosed && pending.get(key) === job) watchDirectory(uri, key);
      });
      target = info.major === 11 ? 'typoscript-v11' : 'typoscript-v12';
    }
    if (disposed || document.isClosed || pending.get(key) !== job || !isTypoScript(document)) return;
    information.set(key, { ...info, mode, languageId: target });
    for (const listener of listeners) listener(document.uri, information.get(key));
    remember(key, target, pinned.has(key) ? 'manual' : 'auto', pinned.get(key));
    prune();
    if (document.languageId === target) { managed.set(key, target); return; }
    switching.add(key);
    try {
      await vscode.languages.setTextDocumentLanguage(document, target);
      managed.set(key, target);
    } finally { switching.delete(key); }
  }

  function enqueue(document) {
    if (disposed || !isTypoScript(document)) return Promise.resolve();
    const key = document.uri.toString();
    const previous = pending.get(key)?.promise || Promise.resolve();
    const job = {};
    pending.set(key, job);
    job.promise = previous.then(() => update(document, key, job)).catch(report).finally(() => {
      if (pending.get(key) === job) pending.delete(key);
    });
    return job.promise;
  }

  function refresh() { return Promise.all(vscode.workspace.textDocuments.map(enqueue)); }
  const subscriptions = [
    vscode.workspace.onDidOpenTextDocument((document) => {
      if (!switching.has(document.uri.toString())) {
        if (document.languageId === 'typoscript') remembered.delete(document.uri.toString());
        void enqueue(document);
      }
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      const key = document.uri.toString();
      if (!switching.has(key)) {
        managed.delete(key); pinned.delete(key); pending.delete(key); information.delete(key);
        dependencies.delete(key); prune();
      }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('typoscriptHighlighting.commentRules')
        || event.affectsConfiguration('typoscriptHighlighting.typo3Version')) void refresh();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => { detector.clear(); void refresh(); })
  ];

  return {
    refresh,
    redetect() { detector.clear(); return refresh(); },
    getInfo(document) { return information.get(document.uri.toString()); },
    onDidResolve(listener) { listeners.add(listener); return { dispose() { listeners.delete(listener); } }; },
    async whenIdle() { while (pending.size) await Promise.all([...pending.values()].map((job) => job.promise)); await persisted; },
    dispose() {
      disposed = true;
      subscriptions.forEach((subscription) => subscription.dispose());
      dependencies.clear(); prune(); detector.clear(); managed.clear(); pinned.clear(); listeners.clear();
    }
  };
}

module.exports = { createController };
