// Structural analysis only: values and conditions are never evaluated.
const PATH = '(?:[a-zA-Z0-9_.-]|\\\\\\.)+';
const statement = new RegExp(`^(${PATH})[ \\t]*(=<|:=|=|<|>|\\{|\\()`);
const constant = /\{\$((?:[a-zA-Z0-9_.-]|\\\.)+)\}/g;

function parse(text, language = 'typoscript-v12') {
  const legacy = language === 'typoscript-v11';
  const lines = text.split(/\r\n|\r|\n/);
  const roots = [], nodes = [], imports = [], references = [], folds = [], errors = [];
  const blocks = [];
  const regions = [];
  const lineKinds = [], depths = [];
  let condition;
  let comment;
  let multiline;
  const error = (line, start, end, code, message) => errors.push({ line, start, end, code, message });
  const parent = () => blocks.at(-1) || condition;
  const add = (node) => {
    node.endLine = node.line;
    node.children = [];
    (parent()?.children || roots).push(node);
    nodes.push(node);
    return node;
  };
  function findReferences(line, value, offset) {
    for (const match of value.matchAll(constant)) references.push({ name: match[1], line,
      start: offset + match.index, end: offset + match.index + match[0].length });
  }
  function findSettingReferences(line, value, offset, direct = false) {
    const getter = direct ? value.match(/^\s*siteSettings:([a-zA-Z0-9_.-]+)/) : null;
    if (getter) {
      const start = offset + getter[0].length - getter[1].length;
      references.push({ kind: 'setting', name: getter[1], line, start, end: start + getter[1].length });
    }
    for (const match of value.matchAll(/\{siteSettings:([a-zA-Z0-9_.-]+)\}/g)) {
      const start = offset + match.index + '{siteSettings:'.length;
      references.push({ kind: 'setting', name: match[1], line, start, end: start + match[1].length });
    }
  }
  function tail(value, line, offset, collect = false) {
    if (legacy) { if (collect) findReferences(line, value, offset); return; }
    let quote = '', escaped = false, depth = 0, segment = 0;
    for (let index = 0; index < value.length; index++) {
      const char = value[index];
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (quote) { if (char === quote) quote = ''; continue; }
      if (char === '"' || char === "'") { quote = char; continue; }
      if (char === '(') depth++;
      else if (char === ')') depth = Math.max(0, depth - 1);
      if (depth || !(char === '#' || value.startsWith('//', index) || value.startsWith('/*', index))) continue;
      if (collect) findReferences(line, value.slice(segment, index), offset + segment);
      if (!value.startsWith('/*', index)) return;
      const end = value.indexOf('*/', index + 2);
      if (end < 0) { comment = { line, start: offset + index }; return; }
      index = end + 1; segment = end + 2;
    }
    if (collect) findReferences(line, value.slice(segment), offset + segment);
  }
  function endCondition(line) {
    if (!condition) return;
    condition.endLine = Math.max(condition.line, line);
    if (condition.endLine > condition.line) folds.push({ start: condition.line, end: condition.endLine, kind: 'condition' });
    condition = undefined;
  }
  function importAt(code, line, offset) {
    const modern = code.match(/^@import\b[ \t]*(['"])(.*?)\1/);
    const old = code.match(/^<INCLUDE_TYPOSCRIPT:\s*(.*?)>/i);
    if (!modern && !old) return false;
    const source = old?.[1].match(/\bsource\s*=\s*(['"])(.*?)\1/i);
    const rawPath = modern?.[2] ?? source?.[2];
    if (rawPath === undefined) return false;
    const file = rawPath.replace(/^FILE:/, '');
    const start = offset + code.indexOf(rawPath);
    const node = add({ kind: 'import', name: file, path: file, line, start, end: start + rawPath.length,
      tagStart: offset, tagEnd: offset + (modern || old)[0].length, legacy: !!old,
      canMigrate: !!old && /^\s*source\s*=\s*(['"]).*?\1\s*$/i.test(old[1])
        && /^(?:EXT:|\.\/)/.test(file) && /\.(?:typoscript|tsconfig)$/.test(file) });
    imports.push(node);
    tail(code.slice((modern || old)[0].length), line, offset + (modern || old)[0].length);
    return true;
  }

  for (let line = 0; line < lines.length; line++) {
    const raw = lines[line];
    depths[line] = blocks.length + (condition ? 1 : 0);
    lineKinds[line] = 'blank';
    if (multiline) {
      lineKinds[line] = 'value';
      const closing = raw.match(/^[ \t]*\)/);
      if (closing) {
        multiline.endLine = line;
        folds.push({ start: multiline.line, end: line - 1, kind: 'value' });
        multiline = undefined;
        depths[line] = blocks.length + (condition ? 1 : 0);
        lineKinds[line] = 'code';
        tail(raw.slice(closing[0].length), line, closing[0].length);
      } else {
        findReferences(line, raw, 0);
        findSettingReferences(line, raw, 0, /(?:^|\.)data$/.test(multiline.path));
      }
      continue;
    }
    let offset = raw.search(/\S/);
    if (offset < 0) continue;
    while (offset < raw.length) {
      const code = raw.slice(offset);
      if (comment) {
        lineKinds[line] = 'comment';
        if (legacy) {
          if (/^\*\//.test(code)) {
            folds.push({ start: comment.line, end: line, kind: 'comment' });
            comment = undefined;
          } else importAt(code, line, offset);
          break;
        }
        const end = raw.indexOf('*/', offset);
        if (end < 0) break;
        if (line > comment.line) folds.push({ start: comment.line, end: line, kind: 'comment' });
        comment = undefined;
        offset = end + 2;
        while (/[ \t]/.test(raw[offset] || '') && offset < raw.length) offset++;
        continue;
      }
      if (/^(?:#|\/\/)/.test(code)) {
        if (/^(?:#|\/\/)\s*region\b/.test(code)) regions.push(line);
        else if (/^(?:#|\/\/)\s*endregion\b/.test(code) && regions.length) folds.push({ start: regions.pop(), end: line, kind: 'region' });
        lineKinds[line] = 'comment'; break;
      }
      if (code.startsWith('/*')) {
        comment = { line, start: offset };
        lineKinds[line] = 'comment';
        if (legacy) break;
        offset += 2;
        continue;
      }
      lineKinds[line] = 'code';
      if (code.startsWith('[')) {
        let depth = 0, quote = '', escaped = false, closing = -1;
        for (let i = 0; i < code.length; i++) {
          const char = code[i];
          if (escaped) { escaped = false; continue; }
          if (char === '\\') { escaped = true; continue; }
          if (quote) { if (char === quote) quote = ''; continue; }
          if (char === '"' || char === "'") { quote = char; continue; }
          if (char === '[') depth++;
          if (char === ']' && --depth === 0) { closing = i; break; }
        }
        if (closing < 0) error(line, offset, raw.length, 'condition', 'Condition has no closing bracket.');
        const value = code.slice(0, closing < 0 ? code.length : closing + 1);
        const keyword = value.toUpperCase();
        // Conditions replace previous conditions; they may also end implicitly at EOF.
        endCondition(line - 1);
        if (blocks.length) {
          // A condition resets TypoScript object scope.
          for (const block of blocks) {
            block.endLine = Math.max(block.line, line - 1);
            error(block.line, block.start, block.end, 'brace', 'Object block must close before a condition resets its scope.');
          }
          blocks.length = 0;
        }
        depths[line] = 0;
        if (!['[END]', '[GLOBAL]'].includes(keyword)) {
          condition = add({ kind: 'condition', name: value, line, start: offset, end: offset + value.length });
        }
        findReferences(line, value, offset);
        if (closing >= 0) tail(code.slice(closing + 1), line, offset + closing + 1);
        break;
      }
      if (importAt(code, line, offset)) {
        if (!legacy && code.startsWith('@import') && blocks.length) error(line, offset, offset + 7, 'import-scope', '@import must be outside object blocks.');
        break;
      }
      if (code.startsWith('}')) {
        const block = blocks.pop();
        depths[line] = blocks.length + (condition ? 1 : 0);
        if (!block) error(line, offset, offset + 1, 'brace', 'Closing brace has no matching object block.');
        else {
          block.endLine = line;
          folds.push({ start: block.line, end: line - 1, kind: 'block' });
        }
        tail(code.slice(1), line, offset + 1);
        break;
      }
      const match = code.match(statement);
      if (!match) { lineKinds[line] = 'unknown'; break; }
      const [, name, operator] = match;
      const fullPath = [blocks.at(-1)?.path, name].filter(Boolean).join('.');
      const valueStart = offset + match[0].length;
      const value = raw.slice(valueStart);
      const kind = ({ '{': 'block', '(': 'multiline', '=': 'assignment', '<': 'copy', '=<': 'reference', ':=': 'modification', '>': 'unset' })[operator];
      const node = add({ kind, name, path: fullPath, operator, line, start: offset, end: offset + name.length, value, valueStart });
      if (kind === 'block') { blocks.push(node); tail(value, line, valueStart); }
      else if (kind === 'multiline') multiline = node;
      else if (kind === 'assignment') {
        findReferences(line, value, valueStart);
        findSettingReferences(line, value, valueStart, /(?:^|\.)data$/.test(fullPath));
      }
      else tail(value, line, valueStart, kind !== 'unset');
      break;
    }
  }
  endCondition(lines.length - 1);
  for (const block of blocks) {
    block.endLine = lines.length - 1;
    error(block.line, block.start, block.end, 'brace', 'Object block has no closing brace.');
  }
  if (multiline) error(multiline.line, multiline.start, multiline.end, 'multiline', 'Multiline value has no closing parenthesis.');
  if (comment) error(comment.line, comment.start, comment.start + 2, 'comment', 'Block comment has no closing delimiter.');
  return { lines, roots, nodes, imports, references, folds: folds.filter((fold) => fold.end > fold.start), errors, lineKinds, depths };
}

function formatIndentation(parsed, options) {
  if (parsed.errors.length) return [];
  const indent = options.insertSpaces ? ' '.repeat(Math.max(1, Math.min(16, Number(options.tabSize) || 4))) : '\t';
  return parsed.lines.flatMap((line, index) => {
    if (parsed.lineKinds[index] !== 'code') return [];
    const existing = line.match(/^[ \t]*/)[0];
    const replacement = indent.repeat(parsed.depths[index]);
    return existing === replacement ? [] : [{ line: index, end: existing.length, text: replacement }];
  });
}

module.exports = { parse, formatIndentation };
