const path = require('node:path').posix;

class Uri {
  constructor(scheme, pathname, authority = '', query = '', fragment = '') {
    Object.assign(this, { scheme, path: pathname, authority, query, fragment });
  }
  static file(pathname) { return new Uri('file', pathname); }
  static joinPath(uri, ...parts) { return uri.with({ path: path.join(uri.path, ...parts) }); }
  with(change) { return new Uri(change.scheme ?? this.scheme, change.path ?? this.path, change.authority ?? this.authority, change.query ?? this.query, change.fragment ?? this.fragment); }
  toString() { return `${this.scheme}://${this.authority}${this.path}${this.query ? `?${this.query}` : ''}${this.fragment ? `#${this.fragment}` : ''}`; }
}

function event() {
  const listeners = new Set();
  return {
    subscribe(callback) { listeners.add(callback); return { dispose() { listeners.delete(callback); } }; },
    fire(value) { for (const callback of [...listeners]) callback(value); },
    get size() { return listeners.size; }
  };
}

function createEditor() {
  const files = new Map();
  const settings = new Map();
  const reads = [];
  const changes = [];
  const watchers = [];
  const events = Object.fromEntries(['open', 'close', 'configuration', 'folders'].map((name) => [name, event()]));
  const editor = {
    files, settings, reads, changes, watchers, events,
    documents: [],
    mode: 'auto',
    readHook: null,
    languageHook: null,
    put(filename, data, scheme = 'file', authority = '') {
      files.set(new Uri(scheme, filename, authority).toString(), typeof data === 'string' ? data : JSON.stringify(data));
    },
    document(filename, languageId = 'typoscript', scheme = 'file', authority = '') {
      const document = { uri: new Uri(scheme, filename, authority), languageId, isClosed: false };
      editor.documents.push(document);
      return document;
    },
    async setLanguage(document, languageId) {
      if (editor.languageHook) await editor.languageHook(document, languageId);
      changes.push({ uri: document.uri.toString(), languageId });
      document.isClosed = true;
      events.close.fire(document);
      const next = { ...document, languageId, isClosed: false };
      editor.documents[editor.documents.indexOf(document)] = next;
      events.open.fire(next);
      return next;
    },
    notifyFile(filename, kind = 'change') {
      for (const watcher of watchers) {
        if (!watcher.disposed && watcher.pattern.baseUri.path === path.dirname(filename)) watcher.events[kind].fire(Uri.file(filename));
      }
    }
  };
  editor.vscode = {
    Uri,
    RelativePattern: class { constructor(baseUri, pattern) { Object.assign(this, { baseUri, pattern }); } },
    workspace: {
      get textDocuments() { return editor.documents; },
      fs: {
        async readFile(uri) {
          reads.push(uri.toString());
          if (editor.readHook) await editor.readHook(uri);
          if (!files.has(uri.toString())) throw Object.assign(new Error('File not found'), { code: 'FileNotFound' });
          return Buffer.from(files.get(uri.toString()));
        }
      },
      getConfiguration(section, uri) {
        return { get: (key, fallback) => settings.get(uri.toString()) ?? editor.mode ?? fallback };
      },
      onDidOpenTextDocument: events.open.subscribe,
      onDidCloseTextDocument: events.close.subscribe,
      onDidChangeConfiguration: events.configuration.subscribe,
      onDidChangeWorkspaceFolders: events.folders.subscribe,
      createFileSystemWatcher(pattern) {
        const signals = { create: event(), change: event(), delete: event() };
        const watcher = {
          pattern, events: signals, disposed: false,
          onDidCreate: signals.create.subscribe,
          onDidChange: signals.change.subscribe,
          onDidDelete: signals.delete.subscribe,
          dispose() { watcher.disposed = true; }
        };
        watchers.push(watcher);
        return watcher;
      }
    },
    languages: { setTextDocumentLanguage: editor.setLanguage }
  };
  return editor;
}

module.exports = { createEditor, Uri };
