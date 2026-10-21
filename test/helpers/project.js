const path = require('node:path').posix;
const assert = require('node:assert/strict');
const { createEditor, Uri } = require('./editor');
const { createProject } = require('../../lib/project');

function matchesGlob(filename, pattern) {
  const braces = pattern.match(/\{([^{}]+)\}/);
  if (braces) return braces[1].split(',').some((part) => matchesGlob(filename, pattern.replace(braces[0], part)));
  let regex = '^';
  for (let index = 0; index < pattern.length; index++) {
    if (pattern.slice(index, index + 3) === '**/') { regex += '(?:.*/)?'; index += 2; }
    else if (pattern.slice(index, index + 2) === '**') { regex += '.*'; index++; }
    else if (pattern[index] === '*') regex += '[^/]*';
    else regex += pattern[index].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(regex + '$').test(filename);
}
function setupProject(t, info = {}, state) {
  const editor = createEditor(), root = info.root || Uri.file('/site');
  editor.vscode.FileType = { File: 1, Directory: 2, SymbolicLink: 64 };
  editor.vscode.workspace.workspaceFolders = [{ uri: root }];
  editor.vscode.workspace.getWorkspaceFolder = () => ({ uri: root });
  editor.vscode.workspace.findFiles = async (pattern, exclude, max = 1000) => [...editor.files.keys()]
    .filter((key) => key.startsWith(pattern.baseUri.toString().replace(/\/$/, '') + '/'))
    .map((key) => new Uri(pattern.baseUri.scheme, key.slice(`${pattern.baseUri.scheme}://${pattern.baseUri.authority}`.length), pattern.baseUri.authority))
    .filter((uri) => matchesGlob(path.relative(pattern.baseUri.path, uri.path), pattern.pattern)
      && (!exclude || !matchesGlob(uri.path.slice(1), exclude))).slice(0, max);
  const project = createProject(editor.vscode, { getInfo: () => ({ root, ...info, ...editor.projectInfo }) }, assert.fail, state);
  t.after(() => project.dispose());
  const document = editor.document(root.path + '/setup.typoscript', 'typoscript-v12', root.scheme, root.authority);
  return { editor, project, document, root };
}
module.exports = { setupProject, matchesGlob };
