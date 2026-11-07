const fs = require('node:fs/promises');
const path = require('node:path');

const globalSettings = {
  'editor.wordWrapColumn': 83,
  'typoscriptHighlighting.theme': 'custom',
  'typoscriptHighlighting.colors.comments': '#111111',
  'typoscriptHighlighting.colors.values': 'custom',
  'typoscriptHighlighting.colors.operators': '#565656',
  'typoscriptHighlighting.skin': 'nord',
  'typoscriptHighlighting.customColors': { values: '#223344' },
  'typoscriptHighlighting.darkColors': { comments: '#225522', conditions: '#446688' },
  'typoscriptHighlighting.commentRules': 'v12',
  'typoscriptHighlighting.customTheme': {
    colors: { comments: '#AB12CD' }, legacy: { darkColors: { comments: '#667788' } }
  }
};
const workspaceSettings = {
  'files.trimTrailingWhitespace': true,
  'typoscriptHighlighting.colors.comments': '#333333',
  'typoscriptHighlighting.colors.objectPaths': '#456789',
  'typoscriptHighlighting.colors.conditions': '#556677',
  'typoscriptHighlighting.colors.imports': '#667788',
  'typoscriptHighlighting.lightColors': { imports: '#777777' },
  'typoscriptHighlighting.customTheme': { colors: { objectPaths: '#ABCDEF' } }
};
const folderSettings = {
  'editor.wordWrapColumn': 91,
  'typoscriptHighlighting.colors.comments': '',
  'typoscriptHighlighting.colors.constants': '#445566',
  'typoscriptHighlighting.colors.functions': '#778899',
  'typoscriptHighlighting.colors.punctuation': '#A0B0C0',
  'typoscriptHighlighting.skin': 'editor',
  'typoscriptHighlighting.commentRules': 'v11',
  'typoscriptHighlighting.customTheme': { colors: { functions: '#AABBCC', values: '#123456' } }
};
const otherFolderSettings = { 'typoscriptHighlighting.colors.comments': '#141414' };

const expected = {
  global: {
    colors: { comments: '#AB12CD', values: 'custom', operators: '#565656' },
    legacy: { skin: 'nord', customColors: { values: '#223344' }, darkColors: { comments: '#667788', conditions: '#446688' }, commentRules: 'v12' }
  },
  workspace: {
    colors: { comments: '#333333', objectPaths: '#ABCDEF', conditions: '#556677', imports: '#667788' },
    legacy: { lightColors: { imports: '#777777' } }
  },
  folder: {
    colors: { comments: '', constants: '#445566', functions: '#AABBCC', punctuation: '#A0B0C0', values: '#123456' },
    legacy: { skin: 'editor', commentRules: 'v11' }
  },
  otherFolder: { colors: { comments: '#141414' } }
};

const jsonc = (value) => '// Migration fixture: preserve comments and unrelated settings.\n'
  + JSON.stringify(value, null, 2).replace(/\n}$/, ',\n}') + '\n';

async function prepare(root, workspace, projects) {
  await fs.mkdir(path.join(root, 'profile', 'User'), { recursive: true });
  await fs.writeFile(path.join(root, 'profile', 'User', 'settings.json'), jsonc(globalSettings));
  await fs.writeFile(workspace, jsonc({ folders: projects.map((name) => ({ path: name })), settings: workspaceSettings }));
  for (const [folder, settings] of [['v11', folderSettings], ['v14', otherFolderSettings]]) {
    await fs.mkdir(path.join(root, folder, '.vscode'), { recursive: true });
    await fs.writeFile(path.join(root, folder, '.vscode', 'settings.json'), jsonc(settings));
  }
}

module.exports = { prepare, expected };
