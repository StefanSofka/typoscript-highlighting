const { parse, printParseErrorCode } = require('jsonc-parser');
const { LEGACY_PATHS, OBJECT_SETTINGS, isObject } = require('./settings');

const SECTION = 'typoscriptHighlighting';
const OLD_KEYS = Object.keys(LEGACY_PATHS);

function mergeSettings(current, entries) {
  if (current !== undefined && !isObject(current)) throw new Error('Custom Theme is not an object; existing settings were left unchanged.');
  const result = { ...current };
  for (const [key, value] of entries) {
    const [container, member] = LEGACY_PATHS[key];
    if (result[container] !== undefined && !isObject(result[container])) {
      throw new Error(`Custom Theme ${container} is not an object; existing settings were left unchanged.`);
    }
    const members = { ...result[container] };
    if (!Object.hasOwn(members, member)) members[member] = value;
    else if (OBJECT_SETTINGS.has(member) && isObject(value) && isObject(members[member])) {
      members[member] = { ...value, ...members[member] };
    }
    result[container] = members;
  }
  return result;
}

function inspectedSettings(configuration, property) {
  return { current: configuration.inspect('customTheme')?.[property],
    entries: OLD_KEYS.map((key) => [key, configuration.inspect(key)?.[property]]).filter(([, value]) => value !== undefined) };
}

async function folderSettings(vscode, folder) {
  const uri = vscode.Uri.joinPath(folder.uri, '.vscode', 'settings.json');
  let bytes;
  try { bytes = await vscode.workspace.fs.readFile(uri); }
  catch (error) {
    if (['FileNotFound', 'ENOENT'].includes(error.code)) return undefined;
    throw error;
  }
  const errors = [];
  const settings = parse(Buffer.from(bytes).toString('utf8').replace(/^\uFEFF/, ''), errors,
    { allowTrailingComma: true, allowEmptyContent: true });
  if (errors.length || (settings !== undefined && !isObject(settings))) {
    const detail = errors.length ? printParseErrorCode(errors[0].error) : 'settings must be an object';
    throw new Error(`Invalid settings JSONC in ${uri.toString()}: ${detail}.`);
  }
  const values = settings || {};
  return { current: values[`${SECTION}.customTheme`],
    entries: OLD_KEYS.filter((key) => Object.hasOwn(values, `${SECTION}.${key}`)).map((key) => [key, values[`${SECTION}.${key}`]]) };
}

async function migrateSettings(vscode, report = () => {}) {
  const workspace = vscode.workspace;
  const targets = vscode.ConfigurationTarget;
  const scopes = [
    { label: 'User settings', target: targets.Global, property: 'globalValue' },
    ...(workspace.workspaceFile || workspace.workspaceFolders?.length
      ? [{ label: 'Workspace settings', target: targets.Workspace, property: 'workspaceValue' }] : []),
    ...(workspace.workspaceFolders || []).map((folder) => ({ label: `Folder ${folder.name || folder.uri.toString()}`,
      target: targets.WorkspaceFolder, uri: folder.uri, folder }))
  ];
  const failed = (scope, error) => report(new Error(`Unable to migrate TypoScript ${scope.label}: ${error.message || error}`));
  for (const scope of scopes) {
    let configuration, entries;
    try {
      configuration = workspace.getConfiguration(SECTION, scope.uri);
      const snapshot = scope.folder ? await folderSettings(vscode, scope.folder) : inspectedSettings(configuration, scope.property);
      if (!snapshot?.entries.length) continue;
      entries = snapshot.entries;
      // Persist the complete scope before removing any old key. Existing members
      // take precedence, including on retries after a partially failed cleanup.
      await configuration.update('customTheme', mergeSettings(snapshot.current, entries), scope.target);
    } catch (error) {
      failed(scope, error);
      continue;
    }
    for (const [key] of entries) {
      try { await configuration.update(key, undefined, scope.target); }
      catch (error) { failed(scope, new Error(`Unable to remove migrated ${key}: ${error.message || error}`)); }
    }
  }
}

module.exports = { migrateSettings };
