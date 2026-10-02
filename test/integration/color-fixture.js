const PALETTE = {
  comments: '#FF0000', objectPaths: '#12AB34', values: '#1234AB', operators: '#AB1234',
  constants: '#ABCDEF', conditions: '#FF00FF', imports: '#00AABB', functions: '#AA6600', punctuation: '#6600CC'
};

function fixture(major) {
  return [`# TYPO3 ${major} Color comment`, 'page = Hello {$site.name}', 'page < lib.example',
    'value := addToList(1)', '[foo == 1]', "@import 'EXT:site/setup.typoscript'", 'page {', '}',
    'literal = # // /**/', 'multiline (', '/* literal {$site.name}', ')', '/**/', 'covered = TEXT', '*/', 'after = Done'].join('\n');
}

function checks(major, palette = PALETTE, offset = 0) {
  const lines = fixture(major).split('\n');
  const cases = [
    ['comments', 0, `# TYPO3 ${major} Color comment`], ['objectPaths', 1, 'page'],
    ['objectPaths', 2, 'lib.example'], ['values', 1, 'Hello'], ['operators', 1, '='],
    ['operators', 3, ':='], ['constants', 1, '{$site.name}'], ['conditions', 4, 'foo == 1'],
    ['imports', 5, '@import'], ['imports', 5, 'EXT:site/setup.typoscript'], ['functions', 3, 'addToList'],
    ['punctuation', 6, '{'], ['punctuation', 7, '}'], ['values', 8, '# // /**/'],
    ['values', 10, '/* literal '], ['constants', 10, '{$site.name}'],
    [major === 11 ? 'comments' : 'objectPaths', 13, 'covered'], ['objectPaths', 15, 'after']
  ];
  return cases.filter(([category]) => palette[category]).map(([category, line, text]) => ({
    category, line: line + offset, start: lines[line].indexOf(text), text, color: palette[category]
  }));
}

module.exports = { PALETTE, fixture, checks };
