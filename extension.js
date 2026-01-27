const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

const LANGUAGE_IDS = new Set(['typoscript', 'typoscript-v11', 'typoscript-v12']);
const DEFAULT_LANGUAGE_ID = 'typoscript-v12';

function activate(context) {
  console.log("TypoScript Highlighting is now active!");

  const updateAll = () => updateOpenDocuments();
  updateAll();

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      updateDocumentLanguage(doc, resolveTargetLanguageId());
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('typoscriptHighlighting.commentRules')) {
        updateAll();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      updateAll();
    })
  );
}

function deactivate() {
  console.log("TypoScript Highlighting is now deactivated.");
}

function updateOpenDocuments() {
  const targetLanguageId = resolveTargetLanguageId();
  vscode.workspace.textDocuments.forEach((doc) => {
    updateDocumentLanguage(doc, targetLanguageId);
  });
}

function updateDocumentLanguage(doc, targetLanguageId) {
  if (!doc || !shouldHandleDocument(doc)) {
    return;
  }

  if (doc.languageId === targetLanguageId) {
    return;
  }

  vscode.languages.setTextDocumentLanguage(doc, targetLanguageId);
}

function shouldHandleDocument(doc) {
  if (LANGUAGE_IDS.has(doc.languageId)) {
    return true;
  }

  if (doc.uri.scheme !== 'file') {
    return false;
  }

  const lowerName = doc.fileName.toLowerCase();
  return lowerName.endsWith('.typoscript') || lowerName.endsWith('.tsconfig');
}

function resolveTargetLanguageId() {
  const config = vscode.workspace.getConfiguration('typoscriptHighlighting');
  const mode = config.get('commentRules', 'auto');

  if (mode === 'v11') {
    return 'typoscript-v11';
  }

  if (mode === 'v12') {
    return 'typoscript-v12';
  }

  const detectedMajor = detectTypo3MajorVersion();
  if (detectedMajor === 11) {
    return 'typoscript-v11';
  }
  if (detectedMajor && detectedMajor >= 12) {
    return 'typoscript-v12';
  }

  return DEFAULT_LANGUAGE_ID;
}

function detectTypo3MajorVersion() {
  const folders = vscode.workspace.workspaceFolders || [];
  let highest = null;

  folders.forEach((folder) => {
    const major = detectTypo3MajorVersionInFolder(folder.uri.fsPath);
    if (!major) {
      return;
    }
    if (!highest || major > highest) {
      highest = major;
    }
  });

  return highest;
}

function detectTypo3MajorVersionInFolder(rootPath) {
  const lockVersion = readTypo3VersionFromComposerLock(path.join(rootPath, 'composer.lock'));
  const version = lockVersion || readTypo3VersionFromComposerJson(path.join(rootPath, 'composer.json'));
  return parseMajorVersion(version);
}

function readTypo3VersionFromComposerLock(lockPath) {
  if (!fs.existsSync(lockPath)) {
    return null;
  }

  try {
    const data = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    const packages = []
      .concat(data.packages || [])
      .concat(data['packages-dev'] || []);
    const pkg = packages.find((entry) => {
      if (!entry || !entry.name) {
        return false;
      }
      return entry.name === 'typo3/cms-core' || entry.name === 'typo3/cms';
    });
    return pkg ? pkg.version : null;
  } catch (error) {
    return null;
  }
}

function readTypo3VersionFromComposerJson(jsonPath) {
  if (!fs.existsSync(jsonPath)) {
    return null;
  }

  try {
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const requires = Object.assign({}, data.require || {}, data['require-dev'] || {});
    return requires['typo3/cms-core'] || requires['typo3/cms'] || null;
  } catch (error) {
    return null;
  }
}

function parseMajorVersion(versionString) {
  if (!versionString || typeof versionString !== 'string') {
    return null;
  }

  const match = versionString.match(/(\\d+)(?:\\.\\d+)?/);
  if (!match) {
    return null;
  }

  const major = parseInt(match[1], 10);
  return Number.isNaN(major) ? null : major;
}

module.exports = {
  activate,
  deactivate
};
