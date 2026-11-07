const { resolveSkin } = require('./skins');
const { getSettings, CATEGORIES, CONFIGURATION_LAYERS } = require('./settings');
const themePalette = (vscode) => [1, 4].includes(vscode.window.activeColorTheme?.kind) ? 'light' : 'dark';
const paletteKey = (palette) => palette === 'base' ? 'colors' : `${palette}Colors`;
const targetProperty = (target) => target === 'user' ? 'globalValue' : target === 'workspace' ? 'workspaceValue' : 'workspaceFolderValue';
const normalize = (value) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : '';
const sourceNames = { defaultValue: 'Default', globalValue: 'User', workspaceValue: 'Workspace', workspaceFolderValue: 'Folder' };

function inspectedSetting(configuration, key, target, category) {
  const layers = configuration.inspect(key) || {};
  const properties = CONFIGURATION_LAYERS.slice(0, CONFIGURATION_LAYERS.indexOf(targetProperty(target)) + 1);
  for (const property of properties.reverse()) {
    const value = category === undefined ? layers[property] : layers[property]?.[category];
    if (value !== undefined) return { value, source: property, local: property === targetProperty(target) };
  }
  return { value: undefined, source: 'defaultValue', local: false };
}

function getSkin(vscode, target, palette = themePalette(vscode), resource) {
  const configuration = getSettings(vscode, target.uri);
  const setting = inspectedSetting(configuration, 'skin', target.id);
  const resolved = resolveSkin(setting.value, palette === 'base' ? themePalette(vscode) : palette);
  let overridden = false;
  if (resource) {
    const layers = getSettings(vscode, resource).inspect('skin') || {};
    const properties = CONFIGURATION_LAYERS.slice(1);
    overridden = properties.slice(properties.indexOf(targetProperty(target.id)) + 1).some((key) => layers[key] !== undefined);
  }
  return { ...resolved, source: sourceNames[setting.source], inherited: !setting.local, overridden };
}

function inspectedValue(configuration, category, target, palette = 'base') {
  const key = palette === 'base' ? `colors.${category}` : paletteKey(palette);
  return inspectedSetting(configuration, key, target, palette === 'base' ? undefined : category);
}

function getColors(vscode, target, palette = 'base', resource) {
  const configuration = getSettings(vscode, target.uri);
  const skin = getSkin(vscode, target, palette);
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
    // An absent override uses the skin. A saved empty string still forces the
    // native editor theme, including when inherited from a narrower scope.
    const fromSkin = chosen.source === 'defaultValue';
    const color = fromSkin ? skin.colors[category] || '' : normalize(value);
    let overridden = false;
    if (resource) {
      const actual = getSettings(vscode, resource);
      const properties = CONFIGURATION_LAYERS.slice(1);
      const currentIndex = properties.indexOf(targetProperty(target.id));
      const inspected = actual.inspect(palette === 'base' ? `colors.${category}` : paletteKey(palette)) || {};
      overridden = properties.slice(currentIndex + 1).some((key) => (palette === 'base' ? inspected[key] : inspected[key]?.[category]) !== undefined);
      if (palette === 'base') {
        const active = actual.get(paletteKey(themePalette(vscode)), {});
        if (active && Object.hasOwn(active, category)) overridden = true;
      }
    }
    const inheritedBase = palette !== 'base' && variant.value === undefined;
    const source = `${inheritedBase ? 'Base palette · ' : ''}${fromSkin ? skin.id === 'editor' ? 'Editor theme' : `${skin.label} skin` : sourceNames[chosen.source]}`;
    return { category, label, description, color, mode: localValue === undefined ? 'inherit' : localValue === '' ? 'theme' : 'color',
      source, overridden };
  });
}

function selectedTheme(vscode, uri) {
  const configuration = getSettings(vscode, uri);
  return inspectedSetting(configuration, 'theme', 'folder:resource');
}

function customColors(vscode, target) {
  const configuration = getSettings(vscode, target.uri);
  const chosen = inspectedSetting(configuration, 'theme', target.id);
  const palette = themePalette(vscode);
  const fallback = resolveSkin(chosen.source !== 'defaultValue' && chosen.value !== 'custom' ? chosen.value : getSkin(vscode, target).selected, palette);
  const defaults = resolveSkin('auto', palette).colors;
  return getColors(vscode, target).map((entry) => ({ category: entry.category, label: entry.label,
    color: inspectedValue(configuration, entry.category, target.id).source !== 'defaultValue' && entry.color
      ? entry.color : fallback.colors[entry.category] || defaults[entry.category] }));
}

function themeColors(vscode, uri) {
  const choice = selectedTheme(vscode, uri);
  // Retain existing configurations until a theme is explicitly selected.
  if (choice.source === 'defaultValue') return undefined;
  if (choice.value !== 'custom') return resolveSkin(choice.value, themePalette(vscode)).colors;
  return Object.fromEntries(getColors(vscode, { id: 'folder:resource', uri }, 'base')
    .filter(({ color }) => color).map(({ category, color }) => [category, color]));
}

module.exports = { CATEGORIES, themePalette, paletteKey, targetProperty, normalize, inspectedSetting, inspectedValue, getSkin, getColors, selectedTheme, themeColors, customColors };
