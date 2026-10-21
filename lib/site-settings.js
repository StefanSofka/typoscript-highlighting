const YAML = require('yaml');

// Inspect scalar definitions only. Aliases, tags, imports and runtime overrides
// are deliberately not resolved; no project code is executed.
function parseSiteSettings(text, filename) {
  if (typeof text !== 'string' || text.length > 512 * 1024) return [];
  const lineCounter = new YAML.LineCounter();
  const document = YAML.parseDocument(text, { lineCounter, strict: true, uniqueKeys: true });
  if (document.errors.length || !YAML.isMap(document.contents)) return [];
  const result = [];
  const scalar = (node) => YAML.isScalar(node) && !node.tag && ['string', 'number', 'boolean'].includes(typeof node.value);
  function add(key, name, value, origin, description) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(name) || !scalar(value) || !key.range) return;
    const location = lineCounter.linePos(key.range[0]);
    result.push({ kind: 'assignment', path: name, name, value: ` ${String(value.value)}`, line: location.line - 1,
      start: location.col - 1, end: location.col - 1 + (key.range[1] - key.range[0]), origin, description });
  }
  function walk(map, prefix = '', depth = 0) {
    if (!YAML.isMap(map) || map.tag || depth > 30 || result.length >= 2000) return;
    for (const pair of map.items) {
      if (!scalar(pair.key)) continue;
      const key = String(pair.key.value);
      if (!prefix && key === 'imports') continue;
      const name = prefix ? `${prefix}.${key}` : key;
      if (YAML.isMap(pair.value)) walk(pair.value, name, depth + 1);
      else add(pair.key, name, pair.value, 'Site setting');
    }
  }
  if (/settings\.definitions\.ya?ml$/.test(filename)) {
    const definitions = document.contents.get('settings', true);
    if (YAML.isMap(definitions)) for (const pair of definitions.items.slice(0, 2000)) {
      if (!scalar(pair.key) || !YAML.isMap(pair.value)) continue;
      const description = pair.value.get('description') || pair.value.get('label');
      add(pair.key, String(pair.key.value), pair.value.get('default', true), 'Site setting default', typeof description === 'string' ? description : undefined);
    }
  } else if (/\/config\.ya?ml$/.test(filename)) walk(document.contents.get('settings', true));
  else walk(document.contents);
  return result;
}

module.exports = { parseSiteSettings };
