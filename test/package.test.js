const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('VSIX file selection contains all runtime files and excludes development tools', () => {
  const executable = path.join(path.dirname(require.resolve('@vscode/vsce/package.json')), 'vsce');
  const files = execFileSync(process.execPath, [executable, 'ls', '--no-dependencies'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' }).trim().split(/\r?\n/);
  for (const file of ['extension.js', 'lib/controller.js', 'lib/version.js', 'language-configuration.json', 'language-configuration-v11.json', 'syntaxes/typoscript.tmLanguage.json', 'syntaxes/typoscript-v11.tmLanguage.json', 'README.md', 'LICENSE', 'package.json', 'images/icon.png']) assert.ok(files.includes(file), file);
  assert.ok(files.every((file) => /^(?:package\.json|README\.md|LICENSE|extension\.js|language-configuration(?:-v11)?\.json|lib\/|syntaxes\/|images\/|docs\/)/.test(file)), JSON.stringify(files));
  assert.ok(files.every((file) => !file.includes('node_modules') && !file.endsWith('.vsix')));
});
