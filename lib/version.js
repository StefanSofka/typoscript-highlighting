const path = require('path').posix;

const TYPO3_PACKAGES = ['typo3/cms-core', 'typo3/cms'];

function parseMajorVersion(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^v?(\d+)(?:\.(?:\d+|x)){0,3}(?:[-+][\w.-]+)?$/i);
  const major = match ? Number(match[1]) : null;
  return Number.isSafeInteger(major) ? major : null;
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

// Only accept constraints whose complete range proves one comment-rule family.
// Unsupported branches and ranges spanning the v11/v12 boundary stay unknown.
function parseConstraintMajor(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const families = [];
  for (const alternative of value.split(/\|\|?/)) {
    let lower = [0, 0, 0];
    let upper = [Infinity, 0, 0];
    let lowerInclusive = true;
    let upperInclusive = false;
    const bound = (version, isLower, inclusive) => {
      const comparison = compare(version, isLower ? lower : upper);
      if (isLower && comparison > 0) {
        lower = version;
        lowerInclusive = inclusive;
      } else if (!isLower && comparison < 0) {
        upper = version;
        upperInclusive = inclusive;
      } else if (comparison === 0) {
        if (isLower) lowerInclusive = lowerInclusive && inclusive;
        else upperInclusive = upperInclusive && inclusive;
      }
    };
    const expression = alternative.trim().replace(/@(dev|alpha|beta|rc|stable)\b/gi, '')
      .replace(/(>=|<=|>|<|=|\^|~)\s+/g, '$1');
    const hyphen = expression.match(/^(\d+(?:\.\d+){0,2})\s+-\s+(\d+(?:\.\d+){0,2})$/);
    const tokens = hyphen ? [`>=${hyphen[1]}`, `<=${hyphen[2]}`] : expression.split(/[\s,]+/);
    for (const token of tokens) {
      const match = token.match(/^(>=|<=|>|<|=|\^|~)?v?(\d+|\*|x)(?:\.(\d+|\*|x))?(?:\.(\d+|\*|x))?(?:-(?:dev|alpha\d*|beta\d*|RC\d*))?$/i);
      if (!match) return null;
      const operator = match[1] || '=';
      const parts = match.slice(2, 5).filter((part) => part !== undefined);
      const wildcard = parts.findIndex((part) => /^(\*|x)$/i.test(part));
      if (wildcard >= 0 && (operator !== '=' || parts.slice(wildcard).some((part) => !/^(\*|x)$/i.test(part)))) return null;
      if (wildcard === 0) continue;
      const version = [0, 0, 0];
      parts.slice(0, wildcard < 0 ? parts.length : wildcard).forEach((part, i) => { version[i] = Number(part); });
      if (version.some((part) => !Number.isSafeInteger(part))) return null;
      if (wildcard > 0 || operator === '^' || operator === '~') {
        bound(version, true, true);
        const end = [...version];
        let index = wildcard > 0 ? wildcard - 1 : 0;
        if (operator === '^') index = version.findIndex((part) => part > 0);
        if (operator === '~') index = parts.length >= 3 ? 1 : 0;
        if (index < 0) index = parts.length - 1;
        end[index]++;
        for (let i = index + 1; i < 3; i++) end[i] = 0;
        bound(end, false, false);
      } else if (operator === '=' || operator === '<=') {
        bound(version, false, true);
        if (operator === '=') bound(version, true, true);
      } else if (operator === '<') bound(version, false, /-(?:dev|alpha|beta|rc)/i.test(token));
      else bound(version, true, operator === '>=');
    }
    const ordering = compare(lower, upper);
    if (ordering > 0 || (ordering === 0 && !(lowerInclusive && upperInclusive))) return null;
    if (lower[0] >= 12) families.push(lower[0]);
    else if (lower[0] === 11 && (compare(upper, [12, 0, 0]) < 0 || (compare(upper, [12, 0, 0]) === 0 && !upperInclusive))) families.push(11);
    else return null;
  }
  if (families.every((major) => major === 11)) return 11;
  if (families.every((major) => major >= 12)) return Math.min(...families);
  return null;
}

function majorFromLock(data) {
  const packages = [...(Array.isArray(data?.packages) ? data.packages : []),
    ...(Array.isArray(data?.['packages-dev']) ? data['packages-dev'] : [])];
  for (const name of TYPO3_PACKAGES) {
    const major = parseMajorVersion(packages.find((entry) => entry?.name === name)?.version);
    if (major >= 11) return major;
  }
  return null;
}

function majorFromManifest(data) {
  for (const name of TYPO3_PACKAGES) {
    const value = data?.require?.[name] ?? data?.['require-dev']?.[name];
    if (value !== undefined) return parseConstraintMajor(value);
  }
  return null;
}

function hasTypo3Package(data, lockfile = false) {
  if (lockfile) {
    return ['packages', 'packages-dev'].some((key) => Array.isArray(data?.[key])
      && data[key].some((entry) => TYPO3_PACKAGES.includes(entry?.name)));
  }
  return TYPO3_PACKAGES.some((name) => data?.require?.[name] !== undefined || data?.['require-dev']?.[name] !== undefined);
}

function createVersionDetector(vscode, watchDirectory = () => {}, report = () => {}) {
  const cache = new Map();
  async function readJson(uri) {
    try {
      return JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8'));
    } catch (error) {
      if (!(error instanceof SyntaxError) && error.code !== 'FileNotFound' && error.code !== 'ENOENT') report(error);
      return null;
    }
  }
  function detectDirectory(uri) {
    const key = uri.toString();
    if (!cache.has(key)) {
      watchDirectory(uri);
      cache.set(key, (async () => {
        const lock = await readJson(vscode.Uri.joinPath(uri, 'composer.lock'));
        const major = majorFromLock(lock);
        if (major) return { major };
        const manifest = await readJson(vscode.Uri.joinPath(uri, 'composer.json'));
        if (hasTypo3Package(lock, true) || hasTypo3Package(manifest)) return { major: majorFromManifest(manifest) };
        return null;
      })());
    }
    return cache.get(key);
  }
  return {
    clear() { cache.clear(); },
    async detect(document) {
      if (!['file', 'vscode-remote'].includes(document.uri.scheme)) return null;
      let directory = document.uri.with({ path: path.dirname(document.uri.path), query: '', fragment: '' });
      if (directory.scheme === 'file' && /^\/[a-zA-Z]:$/.test(directory.path)) {
        directory = directory.with({ path: `${directory.path}/` });
      }
      while (true) {
        const project = await detectDirectory(directory);
        if (project) return project.major;
        // A Windows drive or UNC share is a filesystem root, not a parent project.
        if (directory.scheme === 'file' && (/^\/[a-zA-Z]:\/$/.test(directory.path)
          || (directory.authority && directory.path.split('/').filter(Boolean).length <= 1))) return null;
        let parent = path.dirname(directory.path);
        if (directory.scheme === 'file' && /^\/[a-zA-Z]:$/.test(parent)) parent += '/';
        if (parent === directory.path) return null;
        directory = directory.with({ path: parent });
      }
    }
  };
}

module.exports = { parseMajorVersion, parseConstraintMajor, majorFromLock, majorFromManifest, createVersionDetector };
