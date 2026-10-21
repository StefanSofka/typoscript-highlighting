const { SELECTOR, isTypoScript } = require('./language');
const { createProject } = require('./project');
const { formatIndentation } = require('./parser');
const { SNIPPETS } = require('./snippets');
const { suggestions, migrationHints } = require('./catalog');
const { createSiteSetFeatures, isYaml, settingMarkdown, rangeOf } = require('./site-set-features');

function createLanguageFeatures(vscode, controller, report = () => {}, state) {
  const project = createProject(vscode, controller, report, state);
  const yaml = createSiteSetFeatures(vscode, project);
  const diagnostics = vscode.languages.createDiagnosticCollection('typoscript');
  const jobs = new Map(), timers = new Map();
  let disposed = false;
  const range = (item) => new vscode.Range(item.line, item.start, item.setting ? item.endLine ?? item.line : item.line, item.end);
  const referenceAt = (document, position) => project.analyze(document).references
    .find((item) => item.line === position.line && item.start <= position.character && item.end > position.character);
  async function definitions(document, name, token, settingsOnly = false) {
    return (await project.constantDefinitions(document, token)).filter((node) => node.path === name && (!settingsOnly || node.setting));
  }
  function symbols(document) {
    const parsed = project.analyze(document);
    const convert = (node) => {
      const kind = node.kind === 'block' ? vscode.SymbolKind.Object : node.kind === 'condition' ? vscode.SymbolKind.Boolean
        : node.kind === 'import' ? vscode.SymbolKind.File : vscode.SymbolKind.Property;
      const symbol = new vscode.DocumentSymbol(node.name, node.value?.trim().slice(0, 100) || node.kind, kind,
        new vscode.Range(node.line, node.start, node.endLine, parsed.lines[node.endLine]?.length || node.end), range(node));
      symbol.children = node.children.map(convert);
      return symbol;
    };
    return parsed.roots.map(convert);
  }
  async function documentLinks(document, token) {
    const links = [];
    for (const item of project.analyze(document).imports) {
      if (token?.isCancellationRequested) break;
      const resolved = await project.resolveImport(document, item, token);
      if (!resolved.uris.length) continue;
      const target = resolved.uris.length === 1 ? resolved.uris[0] : vscode.Uri.parse(
        `command:typoscriptHighlighting.openImport?${encodeURIComponent(JSON.stringify([document.uri.toString(), item.path]))}`);
      const link = new vscode.DocumentLink(range(item), target);
      link.tooltip = resolved.uris.length === 1 ? `Open ${resolved.uris[0].path}` : `Choose from ${resolved.uris.length} imported files`;
      links.push(link);
    }
    return links;
  }
  async function openImport(uriString, importPath) {
    if (typeof uriString !== 'string' || typeof importPath !== 'string') return;
    const uri = vscode.Uri.parse(uriString);
    if (!['file', 'vscode-remote'].includes(uri.scheme)) return;
    const document = await vscode.workspace.openTextDocument(uri);
    if (!isTypoScript(document)) return;
    const item = project.analyze(document).imports.find((entry) => entry.path === importPath);
    if (!item) return;
    const resolved = await project.resolveImport(document, item);
    if (!resolved.uris.length) return vscode.window.showWarningMessage(resolved.reason);
    const selected = resolved.uris.length === 1 ? { uri: resolved.uris[0] } : await vscode.window.showQuickPick(
      resolved.uris.map((entry) => ({ label: entry.path.split('/').at(-1), description: entry.path, uri: entry })), { placeHolder: 'Open an imported TypoScript file' });
    if (selected) await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(selected.uri));
  }
  async function completion(document, position, token) {
    const parsed = project.analyze(document);
    if (parsed.lineKinds[position.line] === 'comment') return [];
    const prefix = document.lineAt(position.line).text.slice(0, position.character);
    const candidate = prefix.match(/(?:\{siteSettings:|\bdata\s*=\s*siteSettings:)([a-zA-Z0-9_.-]*)$/);
    const getter = candidate && (candidate[0].startsWith('{') || parsed.nodes.some((node) => node.line === position.line
      && node.kind === 'assignment' && /(?:^|\.)data$/.test(node.path))) ? candidate : null;
    const match = getter || prefix.match(/\{\$([a-zA-Z0-9_.\\-]*)$/);
    if (match) {
      const definitions = getter ? (await project.siteSets.settings(document, token)).definitions : await project.constantDefinitions(document, token);
      if (token?.isCancellationRequested) return [];
      const entries = new Map();
      for (const node of definitions) {
        if (!['assignment', 'multiline'].includes(node.kind) || !node.path.startsWith(match[1]) || node.valid === false) continue;
        if (entries.has(node.path)) continue;
        const item = new vscode.CompletionItem(node.path, vscode.CompletionItemKind.Constant);
        item.detail = `${node.origin} · ${node.uri.path}: ${node.value?.trim() || 'multiline value'}`;
        if (node.description) item.documentation = node.description;
        const suffix = document.lineAt(position.line).text.slice(position.character).match(/^[a-zA-Z0-9_.\\-]*/)[0];
        const end = position.character + suffix.length;
        item.range = new vscode.Range(position.line, position.character - match[1].length, position.line, end);
        item.insertText = node.path + (getter && !candidate[0].startsWith('{') || document.lineAt(position.line).text[end] === '}' ? '' : '}');
        entries.set(node.path, item);
      }
      return [...entries.values()];
    }
    const context = document.uri.path.endsWith('.tsconfig') ? 'tsconfig' : 'setup';
    const catalogue = context === 'setup' && !/(?:^|\/)constants(?:\.[^/]*)?\.(?:typoscript|txt)$/.test(document.uri.path)
      ? suggestions(parsed, position, controller.getInfo(document)).map((entry) => {
        const item = new vscode.CompletionItem(entry.label, entry.kind === 'object' ? vscode.CompletionItemKind.Class : vscode.CompletionItemKind.Property);
        item.detail = entry.detail;
        item.range = new vscode.Range(position.line, entry.start, position.line, position.character);
        item.insertText = entry.insertText;
        item.documentation = new vscode.MarkdownString(`[TYPO3 reference](${entry.url})`);
        return item;
      }) : [];
    if (parsed.lineKinds[position.line] === 'value' || !/^\s*[a-zA-Z]*$/.test(prefix)) return catalogue;
    return [...catalogue, ...SNIPPETS.filter((entry) => entry.scope === 'all' || entry.scope === context).map((entry) => {
      const item = new vscode.CompletionItem(entry.prefix, vscode.CompletionItemKind.Snippet);
      item.detail = entry.name;
      item.insertText = new vscode.SnippetString(entry.body);
      return item;
    })];
  }
  async function definition(document, position, token) {
    const ref = referenceAt(document, position);
    if (ref) return (await definitions(document, ref.name, token, ref.kind === 'setting')).map((node) => new vscode.Location(node.uri, range(node)));
    const node = project.analyze(document).nodes.find((entry) => ['copy', 'reference'].includes(entry.kind)
      && entry.line === position.line && position.character >= entry.valueStart);
    if (!node) return [];
    let target = node.value.trim().match(/^(?:[a-zA-Z0-9_.-]|\\\.)+/)?.[0];
    if (!target) return [];
    if (target.startsWith('.') && node.kind === 'copy') target = node.path.slice(0, Math.max(0, node.path.lastIndexOf('.'))) + target;
    return (await definitions(document, target, token)).filter((entry) => !entry.setting).map((entry) => new vscode.Location(entry.uri, range(entry)));
  }
  async function references(document, position, context, token) {
    const ref = referenceAt(document, position);
    const declaration = project.analyze(document).nodes.find((entry) => ['assignment', 'multiline'].includes(entry.kind)
      && entry.line === position.line && position.character >= entry.start && position.character <= entry.end);
    const name = ref?.name || declaration?.path;
    if (!name) return [];
    const result = (await project.allSources(document, token)).flatMap((source) => source.parsed.references
      .filter((entry) => entry.name === name).map((entry) => new vscode.Location(source.uri, range(entry))));
    if (context.includeDeclaration) result.push(...(await definitions(document, name, token)).map((entry) => new vscode.Location(entry.uri, range(entry))));
    return result;
  }
  async function hover(document, position, token) {
    const ref = referenceAt(document, position);
    if (ref) {
      const matches = await definitions(document, ref.name, token, ref.kind === 'setting');
      if (!matches.length) return;
      const data = await project.siteSets.settings(document, token);
      const content = settingMarkdown(vscode, ref.name, matches, data.context);
      return new vscode.Hover(content, range(ref));
    }
    const node = project.analyze(document).nodes.find((entry) => entry.line === position.line);
    if (!node || project.analyze(document).lineKinds[position.line] !== 'code') return;
    const major = controller.getInfo(document)?.major;
    const version = [11, 12, 13, 14].includes(major) ? `${major}.${({ 11: 5, 12: 4, 13: 4, 14: 3 })[major]}` : 'main';
    const content = new vscode.MarkdownString();
    content.appendText(node.kind === 'import' ? 'TypoScript file import' : `TypoScript ${node.kind}: ${node.path || node.name}`);
    const topic = node.kind === 'import' ? 'FileImports' : node.kind === 'condition' ? 'Conditions' : 'Operators';
    content.appendMarkdown(`\n\n[TYPO3 ${major || ''} documentation](https://docs.typo3.org/m/typo3/reference-typoscript/${version}/en-us/Syntax/${topic}/Index.html)`);
    return new vscode.Hover(content, range(node));
  }
  async function validate(document) {
    if (disposed || document.isClosed || !(isTypoScript(document) || isYaml(document))) return;
    const key = document.uri.toString();
    const job = {};
    jobs.set(key, job);
    if (!vscode.workspace.getConfiguration('typoscriptHighlighting', document.uri).get('diagnostics.enabled', true)) { diagnostics.delete(document.uri); jobs.delete(key); return; }
    const version = document.version;
    if (isYaml(document)) {
      const inspected = await yaml.inspect(document);
      const issues = inspected?.data.issues.get(key) || [];
      const results = issues.map((issue) => {
        const diagnostic = new vscode.Diagnostic(rangeOf(vscode, issue), issue.message,
          issue.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error);
        diagnostic.code = issue.code; diagnostic.source = 'TYPO3 Site Sets'; return diagnostic;
      });
      if (!disposed && !document.isClosed && document.version === version && jobs.get(key) === job) {
        diagnostics.set(document.uri, results); jobs.delete(key);
      }
      return;
    }
    const parsed = project.analyze(document);
    const results = parsed.errors.map((error) => {
      const item = new vscode.Diagnostic(range(error), error.message, vscode.DiagnosticSeverity.Error);
      item.code = error.code; item.source = 'TypoScript'; return item;
    });
    const info = controller.getInfo(document);
    if (!document.uri.path.endsWith('.tsconfig') && !/(?:^|\/)constants(?:\.[^/]*)?\.(?:typoscript|txt)$/.test(document.uri.path)) {
      for (const hint of migrationHints(parsed, info)) {
        const entry = new vscode.Diagnostic(range(hint), hint.message, vscode.DiagnosticSeverity.Warning);
        entry.code = { value: hint.code, target: vscode.Uri.parse(hint.url) }; entry.source = 'TypoScript'; results.push(entry);
      }
    }
    const modernDeprecated = info?.major >= 14 || (info?.major === 13 && (/^v?13\.(?:[4-9]|\d{2,})\./.test(info.version || '') || /^(?:\^|~)?13\.(?:[4-9]|\d{2,})\b/.test(info.constraint || '') || info.source === 'setting'));
    for (const item of parsed.imports) {
      if (disposed || document.isClosed || jobs.get(key) !== job) return;
      if (item.legacy && modernDeprecated) {
        const entry = new vscode.Diagnostic(new vscode.Range(item.line, item.tagStart, item.line, item.tagEnd),
          info.major >= 14 ? 'INCLUDE_TYPOSCRIPT was removed in TYPO3 14. Use @import.' : 'INCLUDE_TYPOSCRIPT is deprecated since TYPO3 13.4. Use @import.',
          info.major >= 14 ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning);
        entry.code = 'legacy-import'; entry.source = 'TypoScript'; results.push(entry);
      }
      const resolved = await project.resolveImport(document, item);
      if (!resolved.uris.length) {
        const entry = new vscode.Diagnostic(range(item), `Import could not be resolved in this project: ${resolved.reason}.`, vscode.DiagnosticSeverity.Warning);
        entry.code = 'unresolved-import'; entry.source = 'TypoScript'; results.push(entry);
      }
    }
    if (!disposed && !document.isClosed && document.version === version && jobs.get(key) === job) {
      diagnostics.set(document.uri, results); jobs.delete(key);
    }
  }
  const pending = new Set();
  function enqueue(document) {
    const promise = validate(document).catch(report).finally(() => pending.delete(promise));
    pending.add(promise); return promise;
  }
  function schedule(document) {
    if (disposed || !(isTypoScript(document) || isYaml(document))) return;
    const key = document.uri.toString();
    jobs.delete(key);
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => { timers.delete(key); void enqueue(document); }, 150));
  }
  function refresh() { project.clear(false); return Promise.all(vscode.workspace.textDocuments.filter((document) => isTypoScript(document) || isYaml(document)).map(enqueue)); }
  const subscriptions = [project, diagnostics, ...yaml.subscriptions,
    project.onDidChange(() => { if (!disposed) vscode.workspace.textDocuments.forEach(schedule); }),
    vscode.languages.registerDocumentSymbolProvider(SELECTOR, { provideDocumentSymbols: symbols }),
    vscode.languages.registerFoldingRangeProvider(SELECTOR, { provideFoldingRanges(document) { return project.analyze(document).folds.map((fold) => new vscode.FoldingRange(fold.start, fold.end, fold.kind === 'comment' ? vscode.FoldingRangeKind.Comment : fold.kind === 'region' ? vscode.FoldingRangeKind.Region : undefined)); } }),
    vscode.languages.registerDocumentLinkProvider(SELECTOR, { provideDocumentLinks: documentLinks }),
    vscode.languages.registerCompletionItemProvider(SELECTOR, { provideCompletionItems: completion }, '$', '.', ':'),
    vscode.languages.registerDefinitionProvider(SELECTOR, { provideDefinition: definition }),
    vscode.languages.registerReferenceProvider(SELECTOR, { provideReferences: references }),
    vscode.languages.registerHoverProvider(SELECTOR, { provideHover: hover }),
    vscode.languages.registerDocumentFormattingEditProvider(SELECTOR, { provideDocumentFormattingEdits(document, options) {
      if (!vscode.workspace.getConfiguration('typoscriptHighlighting', document.uri).get('formatting.enabled', false)) return [];
      return formatIndentation(project.analyze(document), options).map((edit) => vscode.TextEdit.replace(new vscode.Range(edit.line, 0, edit.line, edit.end), edit.text));
    } }),
    vscode.languages.registerCodeActionsProvider(SELECTOR, { provideCodeActions(document, _range, context) {
      return context.diagnostics.filter((item) => item.code === 'legacy-import').flatMap((diagnostic) => {
        const node = project.analyze(document).imports.find((item) => item.line === diagnostic.range.start.line && item.canMigrate);
        if (!node) return [];
        const action = new vscode.CodeAction('Replace with @import', vscode.CodeActionKind.QuickFix);
        action.diagnostics = [diagnostic]; action.isPreferred = true; action.edit = new vscode.WorkspaceEdit();
        action.edit.replace(document.uri, new vscode.Range(node.line, node.tagStart, node.line, node.tagEnd), `@import '${node.path.replace(/'/g, "\\'")}'`);
        return [action];
      });
    } }, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }),
    vscode.commands.registerCommand('typoscriptHighlighting.openImport', (...args) => openImport(...args).catch(report)),
    vscode.workspace.onDidOpenTextDocument(schedule),
    vscode.workspace.onDidChangeTextDocument(({ document }) => schedule(document)),
    vscode.workspace.onDidCloseTextDocument((document) => {
      const key = document.uri.toString(); clearTimeout(timers.get(key)); timers.delete(key); jobs.delete(key); diagnostics.delete(document.uri);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => { if (event.affectsConfiguration('typoscriptHighlighting')) vscode.workspace.textDocuments.forEach(schedule); }),
    controller.onDidResolve((uri) => { project.clear(false); const document = vscode.workspace.textDocuments.find((entry) => entry.uri.toString() === uri.toString()); if (document) schedule(document); })
  ];
  return { refresh, project,
    async whenIdle() { while (pending.size || timers.size) { if (pending.size) await Promise.all([...pending]); else await new Promise((resolve) => setTimeout(resolve, 20)); } },
    dispose() { disposed = true; for (const timer of timers.values()) clearTimeout(timer); timers.clear(); jobs.clear(); subscriptions.forEach((item) => item.dispose()); }
  };
}

module.exports = { createLanguageFeatures };
