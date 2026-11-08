const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { directoryOf, contains, filenameMatcher } = require('../lib/paths');
const { Uri } = require('./helpers/editor');

test('URI containment respects directory boundaries, schemes, authorities and filesystem roots', () => {
  const root = Uri.file('/project');
  assert.ok(contains(root, root));
  assert.ok(contains(root, Uri.file('/project/file.typoscript')));
  assert.ok(contains(Uri.file('/'), root));
  assert.ok(!contains(root, Uri.file('/project-other/file.typoscript')));
  assert.ok(!contains(root, new Uri('vscode-remote', '/project/file.typoscript', 'ssh-remote+host')));
  assert.ok(!contains(new Uri('vscode-remote', '/project', 'first'), new Uri('vscode-remote', '/project/file', 'second')));
  assert.equal(directoryOf(new Uri('vscode-remote', '/project/nested/file.yaml', 'ssh-remote+host')).toString(),
    'vscode-remote://ssh-remote+host/project/nested');
});

test('filename wildcards preserve literal characters and anchored, non-overlapping fragments', () => {
  for (const [filename, pattern, expected] of [
    ['setup.yaml', 'setup.yaml', true], ['setup.yaml.bak', '*.yaml', false],
    ['one(2)+three.yaml', '*(2)+*.yaml', true], ['one(2)+three.yaml', '*[2]*.yaml', false],
    ['abc', 'ab*bc', false], ['a', '*a*a', false], ['aa', '*a*a', true],
    ['foo-middle-bar.yaml', 'foo**middle*bar.yaml', true], ['file.yaml', '**', true],
    ['folder\nname.yaml', '*.yaml', true], ['日本語.yaml', '*.yaml', true]
  ]) assert.equal(filenameMatcher(pattern)(filename), expected, `${pattern}: ${filename}`);
  const matches = filenameMatcher('*part*.yaml');
  assert.deepEqual(['10-part.yaml', 'unrelated.yaml', '20-part.yaml'].filter(matches), ['10-part.yaml', '20-part.yaml']);
});

test('hostile repeated filename wildcards finish without regex backtracking', () => {
  execFileSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const { filenameMatcher } = require('./lib/paths');
    assert.equal(filenameMatcher('*a'.repeat(32) + 'b.yaml')('a'.repeat(240) + '.yaml'), false);
    assert.equal(filenameMatcher('*a'.repeat(32) + '*.yaml')('a'.repeat(240) + '.yaml'), true);
  `], { cwd: path.resolve(__dirname, '..'), timeout: 3000 });
});
