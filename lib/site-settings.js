const YAML = require('yaml');

const SETTING_TYPES = ['string', 'text', 'int', 'number', 'bool', 'stringlist', 'color', 'page'];
const validKey = (name) => typeof name === 'string' && /^[a-zA-Z0-9_.-]+$/.test(name);

function parseYaml(text = '') {
  const counter = new YAML.LineCounter(), issues = [];
  const document = YAML.parseDocument(text.length <= 512 * 1024 ? text : '', { lineCounter: counter, strict: true, uniqueKeys: true });
  const location = (node) => {
    const offset = node?.range?.[0] || 0, end = node?.range?.[1] ?? offset + 1;
    const start = counter.linePos(offset), finish = counter.linePos(end);
    return { line: start.line - 1, start: start.col - 1, endLine: finish.line - 1, end: finish.col - 1 };
  };
  const issue = (node, code, message, severity = 'error') => issues.push({ ...location(node), code, message, severity });
  for (const error of document.errors) issue({ range: error.pos }, 'yaml-syntax', error.message.split('\n')[0]);
  if (text.length > 512 * 1024) issue(null, 'yaml-limit', 'This YAML file exceeds the 512 KiB analysis limit.', 'warning');
  const field = (map, name) => YAML.isMap(map) ? map.items.find((pair) => pair.key?.value === name) : undefined;
  let valueReads = 0;
  const value = (node, seen = new Set()) => {
    if (++valueReads > 20000) return undefined;
    if (!node || seen.has(node) || seen.size > 32 || (node.tag && !node.tag.startsWith('tag:yaml.org,2002:'))) return undefined;
    const next = new Set(seen).add(node);
    if (YAML.isAlias(node)) return value(node.resolve(document), next);
    if (YAML.isScalar(node)) return node.value;
    if (YAML.isSeq(node)) {
      const items = node.items.slice(0, 2000).map((entry) => value(entry, next));
      return items.every((entry) => entry !== undefined) ? items : undefined;
    }
    if (YAML.isMap(node)) return Object.fromEntries(node.items.slice(0, 2000).filter((pair) => YAML.isScalar(pair.key))
      .map((pair) => [String(pair.key.value), value(pair.value, next)]));
  };
  return { text, document, map: YAML.isMap(document.contents) ? document.contents : undefined, location, issue, issues, field, value };
}

const formatValue = (value) => typeof value === 'string' ? value : JSON.stringify(value);

function inspectSettings(text, filename, kind) {
  const model = parseYaml(text), { map, field, value, location, issue } = model;
  const definitions = [], imports = [];
  if (model.document.contents && !map) issue(model.document.contents, 'yaml-shape', 'TYPO3 YAML configuration must contain a mapping.');
  const schema = kind === 'definitions' || /settings\.definitions\.ya?ml$/.test(filename);
  const config = kind === 'config' || /\/config\.ya?ml$/.test(filename);
  const importField = field(map, 'imports');
  if (schema && importField) issue(importField.key, 'definition-import', 'settings.definitions.yaml does not support imports.');
  else if (importField) {
    if (!YAML.isSeq(importField.value)) issue(importField.key, 'yaml-import', 'imports must be a list of resources.');
    else for (const entry of importField.value.items.slice(0, 200)) {
      const resource = field(entry, 'resource'), node = resource?.value || (YAML.isScalar(entry) ? entry : undefined), resourcePath = value(node);
      if (typeof resourcePath !== 'string') { issue(entry, 'yaml-import', 'An import requires a string resource.'); continue; }
      imports.push({ ...location(node), path: resourcePath, glob: value(field(entry, 'glob')?.value) === true, ignoreMissing: value(field(entry, 'ignore_missing')?.value) === true });
    }
  }
  function add(pair, name, raw, origin, metadata = {}) {
    if (!validKey(name)) return;
    definitions.push({ ...location(pair.key), kind: 'assignment', path: name, name, rawValue: raw,
      value: raw === undefined ? undefined : ` ${formatValue(raw)}`, origin, setting: true,
      valueLocation: location(pair.value), ...metadata });
  }
  function walk(tree, prefix = '', depth = 0) {
    if (!YAML.isMap(tree) || tree.tag || depth > 30 || definitions.length >= 2000) return;
    for (const pair of tree.items.slice(0, 2000)) {
      const key = value(pair.key);
      if (typeof key !== 'string' || (!prefix && key === 'imports')) continue;
      const name = prefix ? `${prefix}.${key}` : key;
      if (YAML.isMap(pair.value)) walk(pair.value, name, depth + 1);
      else { const raw = value(pair.value); if (raw !== undefined) add(pair, name, raw, 'Site setting', { flatKey: !prefix && key.includes('.') }); }
    }
  }
  if (!model.document.errors.length && schema) {
    const settings = field(map, 'settings');
    if (settings && !YAML.isMap(settings.value)) issue(settings.key, 'setting-definition', 'settings must contain named setting definitions.');
    for (const pair of (YAML.isMap(settings?.value) ? settings.value.items : []).slice(0, 2000)) {
      const name = value(pair.key);
      if (!validKey(name) || !YAML.isMap(pair.value)) { issue(pair.key, 'setting-definition', 'A setting requires a name and a definition map.'); continue; }
      const type = field(pair.value, 'type'), defaultField = field(pair.value, 'default'), settingType = value(type?.value);
      const enumeration = value(field(pair.value, 'enum')?.value);
      const enumValues = enumeration && !Array.isArray(enumeration) && typeof enumeration === 'object' ? enumeration : undefined;
      if (!SETTING_TYPES.includes(settingType)) issue(type?.value || pair.key, 'setting-type', `Unknown or missing setting type. Use ${SETTING_TYPES.join(', ')}.`);
      if (!defaultField) issue(pair.key, 'setting-default', 'A setting definition requires a default value.');
      if (enumeration !== undefined && !enumValues) issue(field(pair.value, 'enum').key, 'setting-enum', 'enum must map allowed values to their labels.');
      const description = value(field(pair.value, 'description')?.value) || value(field(pair.value, 'label')?.value);
      add(pair, name, value(defaultField?.value), 'Site setting default', { isDefault: true, settingType, enumValues,
        readonly: value(field(pair.value, 'readonly')?.value) === true, description: typeof description === 'string' ? description : undefined,
        valueLocation: location(defaultField?.value || pair.key) });
    }
  } else if (!model.document.errors.length) walk(config ? field(map, 'settings')?.value : map);
  return { ...model, definitions, imports, kind: schema ? 'definitions' : config ? 'config' : 'settings' };
}

function inspectConfig(text, kind = 'set') {
  const model = inspectSettings(text, '/config.yaml', 'config'), { map, field, value, location, issue } = model;
  const nameField = field(map, 'name'), name = value(nameField?.value);
  if (kind === 'set' && (typeof name !== 'string' || !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_./-]+$/.test(name))) {
    issue(nameField?.value || map, 'set-name', 'A site set requires a name such as vendor/my-set.');
  }
  if (kind === 'set' && model.imports.length) {
    issue(field(map, 'imports').key, 'set-config-import', 'Set config.yaml does not support imports. Use dependencies for shared sets.');
    model.imports = [];
  }
  const references = [];
  for (const key of ['dependencies', 'optionalDependencies']) {
    const pair = field(map, key);
    if (!pair) continue;
    if (!YAML.isSeq(pair.value)) { issue(pair.key, 'set-dependencies', `${key} must be a list of set names.`); continue; }
    for (const entry of pair.value.items.slice(0, 1000)) {
      const dependency = value(entry);
      if (typeof dependency !== 'string' || !dependency) issue(entry || pair.key, 'set-dependencies', 'A dependency must be a non-empty set name.');
      else references.push({ ...location(entry), name: dependency, optional: key === 'optionalDependencies' });
    }
  }
  return { ...model, name: typeof name === 'string' ? name : undefined, nameLocation: location(nameField?.value || map),
    label: value(field(map, kind === 'site' ? 'websiteTitle' : 'label')?.value), hidden: value(field(map, 'hidden')?.value) === true, references };
}

function validateSetting(definition, node, checkEnum = true) {
  const raw = node.rawValue;
  if (raw === undefined || (typeof raw === 'string' && /%env\(|\$\{/.test(raw))) return;
  const scalar = raw === null || ['string', 'number', 'boolean'].includes(typeof raw);
  const number = ['string', 'number'].includes(typeof raw) && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(String(raw).trim()) && Number.isFinite(Number(raw));
  let list = raw;
  if (definition.settingType === 'stringlist' && typeof raw === 'string') { try { list = JSON.parse(raw); } catch { /* Not a JSON list. */ } }
  const valid = ({ string: scalar, text: scalar, int: number && Number.isInteger(Number(raw)), page: number && Number.isInteger(Number(raw)), number,
    bool: typeof raw === 'boolean' || [0, 1].includes(raw) || (typeof raw === 'string' && /^(?:true|false|yes|no|on|off|0|1)$/.test(raw)),
    stringlist: Array.isArray(list) && list.every((entry) => ['string', 'number', 'boolean'].includes(typeof entry)),
    color: typeof raw === 'string' && /^(?:#(?:[a-f\d]{3}|[a-f\d]{6}|[a-f\d]{8})|rgba?\([^)]+\))$/i.test(raw) })[definition.settingType];
  if (valid === false) return `Setting ${node.path} expects ${definition.settingType}.`;
  if (checkEnum && definition.enumValues && definition.settingType !== 'stringlist' && !Object.hasOwn(definition.enumValues, String(raw))) return `Setting ${node.path} must be one of: ${Object.keys(definition.enumValues).join(', ')}.`;
}

function parseSiteSettings(text, filename) { return inspectSettings(text, filename).definitions; }

module.exports = { parseSiteSettings, inspectSettings, inspectConfig, parseYaml, validateSetting, formatValue, SETTING_TYPES };
