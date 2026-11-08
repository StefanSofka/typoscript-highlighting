const path = require('node:path').posix;

const directoryOf = (uri) => uri.with({ path: path.dirname(uri.path), query: '', fragment: '' });
const contains = (root, uri) => root.scheme === uri.scheme && root.authority === uri.authority
  && (root.path === uri.path || uri.path.startsWith(root.path.replace(/\/$/, '') + '/'));

// Only '*' is special. Match literal fragments without building a regular
// expression from workspace content, whose repeated wildcards could backtrack.
function filenameMatcher(pattern) {
  const parts = pattern.split(/\*+/);
  if (parts.length === 1) return (filename) => filename === pattern;
  const prefix = parts.shift(), suffix = parts.pop();
  return (filename) => {
    if (!filename.startsWith(prefix) || !filename.endsWith(suffix)) return false;
    let offset = prefix.length;
    const end = filename.length - suffix.length;
    for (const part of parts) {
      const index = filename.indexOf(part, offset);
      if (index < 0 || index + part.length > end) return false;
      offset = index + part.length;
    }
    return offset <= end;
  };
}

module.exports = { directoryOf, contains, filenameMatcher };
