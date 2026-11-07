// Foregrounds only: the editor keeps control of its background and workbench.
const SKINS = [
  {
    id: 'dark', label: 'Dark', description: 'Classic colors for a dark editor background.',
    dark: { comments: '#7FA870', objectPaths: '#9CDCFE', values: '#CE9178', operators: '#C586C0', constants: '#4FC1FF', conditions: '#DCDCAA', imports: '#D7BA7D', functions: '#B5CEA8', punctuation: '#D4D4D4' }
  },
  {
    id: 'light', label: 'Light', description: 'Classic colors for a light editor background.',
    light: { comments: '#426B35', objectPaths: '#005A9C', values: '#A31515', operators: '#6F2B94', constants: '#007080', conditions: '#795E26', imports: '#8A4500', functions: '#176F2C', punctuation: '#383A42' }
  },
  {
    id: 'nord', label: 'Nord', description: 'Cool blue and muted colors; adapts to light and dark editors.',
    dark: { comments: '#A3BE8C', objectPaths: '#88C0D0', values: '#EBCB8B', operators: '#B48EAD', constants: '#D08770', conditions: '#81A1C1', imports: '#8FBCBB', functions: '#E5C07B', punctuation: '#D8DEE9' },
    light: { comments: '#446136', objectPaths: '#275B6B', values: '#775914', operators: '#6E3F67', constants: '#944B2B', conditions: '#355A80', imports: '#226666', functions: '#7A571A', punctuation: '#3B4252' }
  },
  {
    id: 'monokai', label: 'Monokai', description: 'Vivid green, pink and gold; adapts to light and dark editors.',
    dark: { comments: '#A6AA95', objectPaths: '#A6E22E', values: '#E6DB74', operators: '#F56A9B', constants: '#AE81FF', conditions: '#66D9EF', imports: '#FDAD60', functions: '#A6E22E', punctuation: '#F8F8F2' },
    light: { comments: '#5B6250', objectPaths: '#476600', values: '#776000', operators: '#AC1455', constants: '#7040A0', conditions: '#006778', imports: '#945000', functions: '#476600', punctuation: '#383830' }
  },
  {
    id: 'solarized', label: 'Solarized', description: 'Warm earth tones with blue and teal; adapts to light and dark editors.',
    dark: { comments: '#8BA4A6', objectPaths: '#6CB6E8', values: '#BFA34B', operators: '#D67EC1', constants: '#9CA0F5', conditions: '#7EB846', imports: '#53B5AB', functions: '#EE8C69', punctuation: '#A8BFC0' },
    light: { comments: '#586E75', objectPaths: '#216FA6', values: '#806A00', operators: '#A52C78', constants: '#605BB1', conditions: '#577300', imports: '#167A72', functions: '#AD4D16', punctuation: '#3B555E' }
  }
];

const SKIN_OPTIONS = [
  { id: 'auto', label: 'Automatic (Light / Dark)', description: 'Ready to use: follows the editor color mode, including system changes when the editor follows the OS.' },
  ...SKINS.map(({ id, label, description }) => ({ id, label, description })),
  { id: 'editor', label: 'Editor theme', description: 'Use the syntax colors supplied by your editor theme.' }
];
const THEME_OPTIONS = [
  { id: 'auto', label: 'Automatic (Light / Dark)', description: 'Match the light or dark editor appearance.' },
  ...SKINS.map(({ id, label, description }) => ({ id, label, description })),
  { id: 'custom', label: 'Custom', description: 'Use your own syntax colors.' }
];

function normalizeSkin(value) {
  return SKIN_OPTIONS.some(({ id }) => id === value) ? value : 'auto';
}

function resolveSkin(value, palette) {
  const selected = normalizeSkin(value);
  const id = selected === 'auto' ? palette : selected;
  const skin = SKINS.find((entry) => entry.id === id);
  return { selected, id, label: skin?.label || 'Editor theme',
    colors: skin ? skin[palette] || skin.dark || skin.light : {} };
}

module.exports = { SKINS, SKIN_OPTIONS, THEME_OPTIONS, normalizeSkin, resolveSkin };
