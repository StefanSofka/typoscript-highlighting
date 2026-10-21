const vscode = require('vscode');
const { createController } = require('./lib/controller');
const { createColorController } = require('./lib/colors');
const { createColorSettings } = require('./lib/color-settings');
const { createEditorTools } = require('./lib/editor');
const { createLanguageFeatures } = require('./lib/features');
const { createSiteContextTools } = require('./lib/site-context');

async function activate(context) {
  const output = vscode.window.createOutputChannel('TypoScript Highlighting');
  const report = (error) => {
    output.appendLine(`Unable to update TypoScript highlighting: ${error.message || error}`);
  };
  const controller = createController(vscode, report, context.workspaceState);
  const colors = createColorController(vscode, report);
  const colorSettings = createColorSettings(vscode, context.extensionUri, report, context.globalState);
  const editorTools = createEditorTools(vscode, controller, report);
  const features = createLanguageFeatures(vscode, controller, report, context.workspaceState);
  const siteContext = createSiteContextTools(vscode, features.project, report);
  context.subscriptions.push(output, controller, colors, colorSettings, editorTools, features, siteContext);
  await controller.refresh();
  await colors.refresh();
  void features.refresh().catch(report);
  return {
    getSiteContext(document) { return features.project.siteSets.context(document); },
    selectSiteContext(document, uri) { return features.project.siteSets.select(document, uri); },
    getInfo(document) { return controller.getInfo(document); },
    async refresh() { await controller.refresh(); await colors.refresh(); await features.refresh(); await siteContext.refresh(); },
    async whenIdle() { await colorSettings.whenIdle(); await controller.whenIdle(); await colors.whenIdle(); await features.whenIdle(); await siteContext.whenIdle(); }
  };
}

module.exports = { activate };
