const { isTypoScript } = require('./language');
const { isYaml } = require('./site-set-features');
const { contains } = require('./site-sets');

const supportsContext = (document) => !!document && ['file', 'vscode-remote'].includes(document.uri.scheme)
  && (isTypoScript(document) || isYaml(document));

function describeContext(context) {
  const name = context.site ? `Site: ${context.site.id}` : context.currentSet ? `Set: ${context.currentSet.name}`
    : context.kind === 'ambiguous' ? 'Choose site context' : 'No active site sets';
  return { text: name, detail: `${context.selected ? 'Selected site context' : 'Automatic file context'} · ${context.sets.length} sets\n${context.sets.map((set, index) => `${index + 1}. ${set.name}`).join('\n')}` };
}

function createSiteContextTools(vscode, project, report = () => {}) {
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 19);
  status.name = 'TypoScript site context'; status.command = 'typoscriptHighlighting.selectSiteContext';
  let generation = 0, disposed = false;
  const pending = new Set();
  async function update() {
    const job = ++generation, document = vscode.window.activeTextEditor?.document;
    if (disposed || !supportsContext(document)) { status.hide(); return; }
    const context = await project.siteSets.context(document);
    if (disposed || job !== generation) return;
    if (!context.registry.sites.length && !context.registry.all.length) { status.hide(); return; }
    const description = describeContext(context);
    status.text = `$(layers) ${description.text}`;
    status.tooltip = `${description.detail}\nClick to select a site. Use Inspect Site Sets for load order and source files.`;
    status.show();
  }
  const refresh = () => {
    const promise = update().catch(report).finally(() => pending.delete(promise));
    pending.add(promise); return promise;
  };
  async function selectContext() {
    const document = vscode.window.activeTextEditor?.document;
    if (!supportsContext(document)) return;
    const context = await project.siteSets.context(document);
    const selected = await vscode.window.showQuickPick([
      { label: 'Automatic file context', description: 'Use the site containing this file, its sole consumer, or the current set', automatic: true },
      ...context.registry.sites.map((site) => ({ label: site.id, description: site.label || site.dir.path,
        detail: project.siteSets.closure(context.registry, (site.resolvedReferences || site.references).map((ref) => ref.name)).map((set) => set.name).join(' → '), uri: site.dir }))
    ], { title: 'TypoScript site context', placeHolder: 'Select the site used for shared TypoScript and settings navigation' });
    if (selected) { await project.siteSets.select(document, selected.uri); await refresh(); }
  }
  async function inspectSets() {
    const document = vscode.window.activeTextEditor?.document;
    if (!supportsContext(document)) return;
    const context = await project.siteSets.context(document);
    const root = context.registry.info.root;
    const options = context.sets.map((set, index) => ({ label: `${index + 1}. ${set.name}`, description: set.label || '',
      detail: contains(root, set.uri) ? set.uri.path.slice(root.path.replace(/\/$/, '').length + 1) : set.uri.toString(), uri: set.uri }));
    const selected = await vscode.window.showQuickPick([
      { label: 'Select site context…', description: context.site?.id || context.currentSet?.name || 'Automatic', select: true },
      ...(context.site ? [{ label: 'Open site configuration', description: context.site.id, uri: context.site.uri }] : []), ...options
    ], { title: `${describeContext(context).text} · ${context.sets.length} sets in load order`, placeHolder: 'Open a set configuration to inspect dependencies' });
    if (selected?.select) return selectContext();
    if (selected?.uri) return vscode.window.showTextDocument(await vscode.workspace.openTextDocument(selected.uri));
  }
  const handle = (action) => () => action().catch(report);
  const subscriptions = [status, project.onDidChange(refresh), vscode.window.onDidChangeActiveTextEditor(refresh),
    vscode.commands.registerCommand('typoscriptHighlighting.selectSiteContext', handle(selectContext)),
    vscode.commands.registerCommand('typoscriptHighlighting.showSiteSets', handle(inspectSets))];
  void refresh();
  return { refresh, async whenIdle() { while (pending.size) await Promise.all([...pending]); },
    dispose() { disposed = true; generation++; subscriptions.forEach((item) => item.dispose()); } };
}

module.exports = { createSiteContextTools, describeContext };
