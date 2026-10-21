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
const PALETTES = ['base', 'dark', 'light'];
const themePalette = (vscode) => [1, 4].includes(vscode.window.activeColorTheme?.kind) ? 'light' : 'dark';
const paletteKey = (palette) => palette === 'base' ? 'colors' : `${palette}Colors`;
const targetProperty = (target) => target === 'user' ? 'globalValue' : target === 'workspace' ? 'workspaceValue' : 'workspaceFolderValue';
const normalize = (value) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : '';

function inspectedValue(configuration, category, target, palette = 'base') {
  const key = palette === 'base' ? `colors.${category}` : paletteKey(palette);
  const layers = configuration.inspect(key) || {};
  const properties = ['defaultValue', 'globalValue', ...(target !== 'user' ? ['workspaceValue'] : []), ...(target.startsWith('folder:') ? ['workspaceFolderValue'] : [])];
  for (const property of properties.reverse()) {
    const value = palette === 'base' ? layers[property] : layers[property]?.[category];
    if (value !== undefined) return { value, source: property, local: property === targetProperty(target) };
  }
  return { value: undefined, source: 'defaultValue', local: false };
}

function getColors(vscode, target, palette = 'base', resource) {
  const configuration = vscode.workspace.getConfiguration('typoscriptHighlighting', target.uri);
  const sourceNames = { defaultValue: 'Editor theme', globalValue: 'User', workspaceValue: 'Workspace', workspaceFolderValue: 'Folder' };
  return CATEGORIES.map(([category, label, description]) => {
    const base = inspectedValue(configuration, category, target.id);
    const variant = palette === 'base' ? {} : inspectedValue(configuration, category, target.id, palette);
    const chosen = variant.value !== undefined ? variant : base;
    let value = chosen.value;
    if (value === 'custom') {
      const layers = configuration.inspect('customColors') || {};
      value = Object.assign({}, layers.defaultValue, layers.globalValue,
        target.id === 'user' ? {} : layers.workspaceValue,
        target.id.startsWith('folder:') ? layers.workspaceFolderValue : {})[category];
    }
    const own = configuration.inspect(palette === 'base' ? `colors.${category}` : paletteKey(palette))?.[targetProperty(target.id)];
    const localValue = palette === 'base' ? own : own?.[category];
    const color = normalize(value);
    let overridden = false;
    if (resource) {
      const actual = vscode.workspace.getConfiguration('typoscriptHighlighting', resource);
      const properties = ['globalValue', 'workspaceValue', 'workspaceFolderValue'];
      const currentIndex = properties.indexOf(targetProperty(target.id));
      const inspected = actual.inspect(palette === 'base' ? `colors.${category}` : paletteKey(palette)) || {};
      overridden = properties.slice(currentIndex + 1).some((key) => (palette === 'base' ? inspected[key] : inspected[key]?.[category]) !== undefined);
      if (palette === 'base') {
        const active = actual.get(paletteKey(themePalette(vscode)), {});
        if (active && Object.hasOwn(active, category)) overridden = true;
      }
    }
    const inheritedBase = palette !== 'base' && variant.value === undefined;
    const source = `${inheritedBase ? 'Base palette · ' : ''}${sourceNames[chosen.source]}`;
    return { category, label, description, color, mode: localValue === undefined ? 'inherit' : localValue === '' ? 'theme' : 'color',
      source, overridden };
  });
}

module.exports = { CATEGORIES, PALETTES, themePalette, paletteKey, targetProperty, normalize, inspectedValue, getColors };
