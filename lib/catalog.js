// A deliberately small, documented core catalogue. Unknown/custom cObjects and
// properties remain valid; this is completion assistance, not a schema checker.
const OBJECTS = {
  PAGE: ['typeNum', 'config', 'bodyTag', 'bodyTagCObject', 'headerData', 'footerData', 'includeCSS', 'includeJS', 'includeJSFooter', 'meta', 'shortcutIcon'],
  TEXT: ['value', 'data', 'field', 'wrap', 'ifEmpty', 'required', 'trim', 'htmlSpecialChars', 'typolink', 'stdWrap'],
  COA: ['wrap', 'stdWrap', 'if', 'cache'], COA_INT: ['wrap', 'stdWrap', 'if'],
  FLUIDTEMPLATE: ['file', 'templateName', 'templateRootPaths', 'partialRootPaths', 'layoutRootPaths', 'variables', 'settings', 'dataProcessing', 'stdWrap'],
  PAGEVIEW: ['paths', 'variables', 'dataProcessing'],
  CONTENT: ['table', 'select', 'renderObj', 'wrap', 'stdWrap', 'if'],
  RECORDS: ['source', 'tables', 'conf', 'dontCheckPid', 'wrap', 'stdWrap'],
  HMENU: ['special', 'special.value', 'entryLevel', 'excludeUidList', 'includeNotInMenu', 'wrap', 'stdWrap'],
  IMAGE: ['file', 'altText', 'titleText', 'params', 'imageLinkWrap', 'stdWrap'],
  IMG_RESOURCE: ['file', 'stdWrap'], FILES: ['files', 'references', 'collections', 'folders', 'sorting', 'renderObj', 'stdWrap'],
  USER: ['userFunc', 'stdWrap'], USER_INT: ['userFunc', 'stdWrap'],
  CASE: ['key', 'default', 'stdWrap'], LOAD_REGISTER: [], RESTORE_REGISTER: []
};
const STDWRAP = ['data', 'field', 'value', 'ifEmpty', 'ifBlank', 'required', 'trim', 'wrap', 'noTrimWrap', 'prepend', 'append', 'typolink', 'htmlSpecialChars', 'crop', 'case', 'if'];
const CONFIG = ['absRefPrefix', 'doctype', 'no_cache', 'compressCss', 'compressJs', 'concatenateCss', 'concatenateJs', 'cache_period', 'noPageTitle'];

function exactVersion(info = {}) {
  if (['core', 'installed', 'lock'].includes(info.source)) {
    const match = info.version?.match(/^v?(\d+)\.(\d+)\.(\d+)/);
    if (match) return match.slice(1).map(Number);
  }
  if (info.source === 'setting') return [info.major, 0, 0];
  return null;
}
function available(name, info = {}) {
  if (name !== 'PAGEVIEW') return true;
  if (info.source === 'setting') return info.major >= 13;
  const version = exactVersion(info);
  return version ? version[0] > 13 || (version[0] === 13 && version[1] >= 1) : info.major >= 13;
}
function documentation(name, major) {
  const version = ({ 11: '11.5', 12: '12.4', 13: '13.4', 14: '14.3' })[major] || 'main';
  const directory = ({ COA: 'CoaAndCoaInt', COA_INT: 'CoaAndCoaInt', USER: 'UserAndUserInt', USER_INT: 'UserAndUserInt',
    IMG_RESOURCE: 'ImgResource', LOAD_REGISTER: 'LoadRegister', RESTORE_REGISTER: 'RestoreRegister' })[name] || `${name[0]}${name.slice(1).toLowerCase()}`;
  const topic = name === 'PAGE' ? 'TopLevelObjects/Page/Index' : name === 'config' ? 'TopLevelObjects/Config'
    : name === 'stdWrap' ? 'Functions/Stdwrap' : `ContentObjects/${directory}/Index`;
  return `https://docs.typo3.org/m/typo3/reference-typoscript/${version}/en-us/${topic}.html`;
}
function suggestions(parsed, position, info = {}) {
  if (['comment', 'value'].includes(parsed.lineKinds[position.line])) return [];
  const prefix = parsed.lines[position.line].slice(0, position.character);
  const rhs = prefix.match(/^\s*[\w.\\-]+\s*=\s*([A-Z_]*)$/);
  if (rhs) return Object.keys(OBJECTS).filter((name) => name.startsWith(rhs[1]) && available(name, info)).map((name) => ({
    label: name, start: position.character - rhs[1].length, insertText: name, kind: 'object', detail: `TYPO3 ${name} content object${name === 'PAGEVIEW' ? ' (since 13.1)' : ''}`, url: documentation(name, info.major)
  }));
  const lhs = prefix.match(/^\s*([a-zA-Z0-9_.\\-]*)$/);
  if (!lhs) return [];
  const scope = parsed.nodes.filter((node) => node.kind === 'block' && node.line < position.line && node.endLine >= position.line).at(-1)?.path;
  const full = [scope, lhs[1]].filter(Boolean).join('.');
  const dot = full.lastIndexOf('.');
  if (dot < 0) return [];
  const parent = full.slice(0, dot), partial = full.slice(dot + 1);
  let type;
  if (parent === 'config' || parent.endsWith('.config')) type = 'config';
  else if (parent.endsWith('.stdWrap')) type = 'stdWrap';
  else {
    const assignment = parsed.nodes.filter((node) => node.kind === 'assignment' && node.path === parent && node.line < position.line).at(-1);
    const name = assignment?.value.trim().match(/^([A-Z_]+)(?:\s*(?:#|\/\/|\/\*).*)?$/)?.[1];
    if (name && OBJECTS[name] && available(name, info)) type = name;
  }
  const properties = type === 'config' ? CONFIG : type === 'stdWrap' ? STDWRAP : OBJECTS[type];
  return (properties || []).filter((property) => property.startsWith(partial)).map((property) => ({ label: property,
    start: position.character - partial.length, insertText: property, kind: 'property', detail: `${type}.${property}`, url: documentation(type, info.major) }));
}

function migrationHints(parsed, info) {
  const version = exactVersion(info);
  if (!version || version[0] < 11 || version[0] > 14) return [];
  return parsed.nodes.filter((node) => node.kind === 'assignment').flatMap((node) => {
    const name = node.value.trim().match(/^([A-Z_]+)(?:\s*(?:#|\/\/|\/\*).*)?$/)?.[1];
    if (name === 'TEMPLATE') return [{ ...node, code: 'removed-template', message: 'The core TEMPLATE content object was removed in TYPO3 11. Migrate to FLUIDTEMPLATE unless an extension supplies a custom TEMPLATE object.', url: documentation('FLUIDTEMPLATE', info.major) }];
    if (name === 'PAGEVIEW' && !available(name, info)) return [{ ...node, code: 'unavailable-pageview', message: 'The core PAGEVIEW content object requires TYPO3 13.1 or newer. Use FLUIDTEMPLATE for older targets unless an extension supplies this object.', url: documentation('FLUIDTEMPLATE', info.major) }];
    return [];
  });
}

module.exports = { suggestions, migrationHints, documentation };
