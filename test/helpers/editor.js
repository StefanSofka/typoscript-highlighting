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
  const events = Object.fromEntries(['open', 'close', 'configuration', 'folders', 'visible', 'text'].map((name) => [name, event()]));
  const editor = {
    files, settings, reads, changes, watchers, events,
    palettes: new Map(), customColors: new Map(), styles: [], editors: [],
    documents: [],
    mode: 'auto',
    readHook: null,
    languageHook: null,
    put(filename, data, scheme = 'file', authority = '') {
      files.set(new Uri(scheme, filename, authority).toString(), typeof data === 'string' ? data : JSON.stringify(data));
    },
    document(filename, languageId = 'typoscript', scheme = 'file', authority = '') {
      const document = { uri: new Uri(scheme, filename, authority), languageId, isClosed: false,
        version: 1, text: '', getText() { return this.text; } };
      editor.documents.push(document);
      return document;
    },
    textEditor(document) {
      const textEditor = { document, decorations: new Map(),
        setDecorations(style, ranges) { this.decorations.set(style, ranges); } };
      editor.editors.push(textEditor);
      editor.vscode.window.visibleTextEditors.push(textEditor);
      return textEditor;
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
        return { get: (key, fallback) => key.startsWith('colors.')
          ? editor.palettes.get(uri.toString())?.[key.slice(7)] ?? fallback
          : key === 'customColors' ? editor.customColors.get(uri.toString()) ?? fallback
          : settings.get(uri.toString()) ?? editor.mode ?? fallback };
      },
      onDidChangeTextDocument: events.text.subscribe,
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
    window: {
      visibleTextEditors: [],
      onDidChangeVisibleTextEditors: events.visible.subscribe,
      createTextEditorDecorationType(options) {
        const style = { options, disposed: false, dispose() {
          this.disposed = true;
          for (const textEditor of editor.editors) textEditor.decorations.delete(this);
        } };
        editor.styles.push(style);
        return style;
      }
    },
    DecorationRangeBehavior: { ClosedClosed: 1 },
    Range: class {
      constructor(startLine, startCharacter, endLine, endCharacter) {
        this.start = { line: startLine, character: startCharacter };
        this.end = { line: endLine, character: endCharacter };
      }
    },
    languages: { setTextDocumentLanguage: editor.setLanguage }
  };
  return editor;
}

module.exports = { createEditor, Uri };
