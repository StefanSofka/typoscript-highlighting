const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('VSIX file selection contains all runtime files and excludes development tools', () => {
  const executable = path.join(path.dirname(require.resolve('@vscode/vsce/package.json')), 'vsce');
  const files = execFileSync(process.execPath, [executable, 'ls'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' }).trim().split(/\r?\n/);
  const engineFiles = [
    'node_modules/vscode-textmate/package.json', 'node_modules/vscode-textmate/LICENSE.md',
    'node_modules/vscode-textmate/release/main.js', 'node_modules/vscode-oniguruma/package.json',
    'node_modules/vscode-oniguruma/LICENSE.txt', 'node_modules/vscode-oniguruma/NOTICES.txt',
    'node_modules/vscode-oniguruma/release/main.js', 'node_modules/vscode-oniguruma/release/onig.wasm'
  ];
  for (const file of ['extension.js', 'lib/controller.js', 'lib/version.js', 'lib/colors.js', 'lib/tokenizer.js', 'lib/color-settings.js', 'media/color-settings.js', 'media/color-settings.css', 'language-configuration.json', 'language-configuration-v11.json', 'syntaxes/typoscript.tmLanguage.json', 'syntaxes/typoscript-v11.tmLanguage.json', 'README.md', 'LICENSE', 'package.json', 'images/icon.png', ...engineFiles]) assert.ok(files.includes(file), file);
  assert.ok(files.every((file) => engineFiles.includes(file)
    || /^(?:package\.json|README\.md|LICENSE|extension\.js|language-configuration(?:-v11)?\.json|lib\/|media\/|syntaxes\/|images\/|docs\/)/.test(file)), JSON.stringify(files));
  assert.ok(files.every((file) => !file.endsWith('.vsix')));
});
