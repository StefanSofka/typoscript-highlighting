const vscode = require('vscode');
const { createController } = require('./lib/controller');

async function activate(context) {
  const output = vscode.window.createOutputChannel('TypoScript Highlighting');
  const controller = createController(vscode, (error) => {
    output.appendLine(`Unable to update TypoScript highlighting: ${error.message || error}`);
  });
  context.subscriptions.push(output, controller);
  await controller.refresh();
  return controller;
}

module.exports = { activate };
