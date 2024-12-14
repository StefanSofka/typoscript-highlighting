const vscode = require('vscode');

function activate(context) {
  console.log("TypoScript Highlighting is now active!");
}

function deactivate() {
  console.log("TypoScript Highlighting is now deactivated.");
}

module.exports = {
  activate,
  deactivate
};

