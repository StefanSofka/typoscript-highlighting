const vscode = require('vscode');
const { createController } = require('./lib/controller');
const { createColorController } = require('./lib/colors');
const { createColorSettings } = require('./lib/color-settings');

async function activate(context) {
  const output = vscode.window.createOutputChannel('TypoScript Highlighting');
  const report = (error) => {
    output.appendLine(`Unable to update TypoScript highlighting: ${error.message || error}`);
  };
  const controller = createController(vscode, report);
  const colors = createColorController(vscode, report);
  const colorSettings = createColorSettings(vscode, context.extensionUri, report);
  context.subscriptions.push(output, controller, colors, colorSettings);
  await controller.refresh();
  await colors.refresh();
  return {
    async refresh() { await controller.refresh(); await colors.refresh(); },
    async whenIdle() { await colorSettings.whenIdle(); await controller.whenIdle(); await colors.whenIdle(); }
  };
}

module.exports = { activate };
