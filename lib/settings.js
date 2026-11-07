const CATEGORIES = [
  ['comments', 'Comments', 'Line, block and documentation comments'],
  ['objectPaths', 'Object paths', 'Paths and copy/reference targets'],
  ['values', 'Values', 'Assignment values and quoted strings'],
  ['operators', 'Operators', 'Assignment, copy, modification and deletion'],
  ['constants', 'Constants', 'References such as {$site.name}'],
  ['conditions', 'Conditions', 'Conditions and END / GLOBAL / ELSE'],
  ['imports', 'Imports', 'Import keywords, paths and attributes'],
  ['functions', 'Functions', 'Value modifiers such as addToList'],
  ['punctuation', 'Punctuation', 'Braces, parentheses and closing brackets']
];
const COLOR_CATEGORIES = CATEGORIES.map(([category]) => category);
const OBJECT_SETTINGS = new Set(['colors', 'darkColors', 'lightColors', 'customColors']);
const LEGACY_PATHS = Object.fromEntries([
  ...COLOR_CATEGORIES.map((category) => [`colors.${category}`, ['colors', category]]),
  ...['skin', 'darkColors', 'lightColors', 'customColors', 'commentRules'].map((key) => [key, ['legacy', key]])
]);
const PATHS = { ...LEGACY_PATHS, colors: ['colors'] };
const CONFIGURATION_LAYERS = ['defaultValue', 'globalValue', 'workspaceValue', 'workspaceFolderValue'];
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const member = (value, path) => path.reduce((entry, key) => isObject(entry) ? entry[key] : undefined, value);

// Keep color/legacy resolution in one place while storing a single scoped object.
// Raw legacy values are a fallback if a configuration file could not be migrated.
function getSettings(vscode, uri) {
  const current = () => vscode.workspace.getConfiguration('typoscriptHighlighting', uri);
  function inspect(key) {
    const configuration = current();
    const path = PATHS[key];
    if (!path) return configuration.inspect(key);
    const previous = configuration.inspect(key) || {};
    const stored = configuration.inspect('customTheme') || {};
    const result = { defaultValue: key.startsWith('colors.') ? '' : ['skin', 'commentRules'].includes(key) ? 'auto' : {} };
    for (const layer of CONFIGURATION_LAYERS.slice(1)) {
      const old = previous[layer];
      const value = member(stored[layer], path);
      if (value !== undefined || old !== undefined) {
        result[layer] = isObject(value) && isObject(old) ? { ...old, ...value } : value !== undefined ? value : old;
      }
    }
    return result;
  }
  function get(key, fallback) {
    if (!PATHS[key]) return current().get(key, fallback);
    const layers = inspect(key);
    const values = CONFIGURATION_LAYERS.map((layer) => layers[layer]).filter((value) => value !== undefined);
    if (OBJECT_SETTINGS.has(key)) return Object.assign({}, ...values.filter(isObject));
    return values.at(-1) ?? fallback;
  }
  async function update(key, value, target) {
    const configuration = current();
    const path = PATHS[key];
    if (!path) return configuration.update(key, value, target);
    const property = target === vscode.ConfigurationTarget.Global ? 'globalValue'
      : target === vscode.ConfigurationTarget.Workspace ? 'workspaceValue' : 'workspaceFolderValue';
    const own = configuration.inspect('customTheme')?.[property];
    const data = isObject(own) ? { ...own } : {};
    if (path.length === 1) {
      if (value === undefined) delete data[path[0]];
      else data[path[0]] = value;
    } else {
      const branch = isObject(data[path[0]]) ? { ...data[path[0]] } : {};
      if (value === undefined) delete branch[path[1]];
      else branch[path[1]] = value;
      if (Object.keys(branch).length) data[path[0]] = branch;
      else delete data[path[0]];
    }
    return configuration.update('customTheme', Object.keys(data).length ? data : undefined, target);
  }
  return { inspect, get, update };
}

module.exports = { getSettings, CATEGORIES, COLOR_CATEGORIES, LEGACY_PATHS, OBJECT_SETTINGS, CONFIGURATION_LAYERS, isObject };
