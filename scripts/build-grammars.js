const fs = require('node:fs');
const path = require('node:path');

const objectPath = '(?:[a-zA-Z0-9_.-]|\\\\\\.)+';
const start = '(?:^|(?<=\\*/))[ \\t]*';
const capture = (name) => ({ name });
const quoted = [
  { name: 'string.quoted.single.typoscript', match: "'(?:\\\\.|[^'\\\\])*'" },
  { name: 'string.quoted.double.typoscript', match: '"(?:\\\\.|[^"\\\\])*"' }
];

function createGrammar(legacy) {
  const commentStart = legacy ? '^[ \\t]*' : '';
  const blockEnd = legacy ? '^[ \\t]*\\*/.*$' : '\\*/';
  return {
    $schema: 'https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json',
    name: legacy ? 'TypoScript (v11)' : 'TypoScript (v12+)',
    scopeName: legacy ? 'source.typoscript.v11' : 'source.typoscript',
    patterns: [{ include: '#comments' }, { include: '#statements' }],
    repository: {
      comments: {
        patterns: [
          {
            name: 'comment.block.documentation.typoscript',
            // In /**/, the second star belongs to the closing delimiter.
            begin: `${commentStart}/\\*\\*(?!/)`, end: blockEnd,
            beginCaptures: { 0: capture('punctuation.definition.comment.begin.typoscript') },
            endCaptures: { 0: capture('punctuation.definition.comment.end.typoscript') },
            patterns: legacy ? [{ include: '#imports' }] : []
          },
          {
            name: 'comment.block.typoscript',
            begin: `${commentStart}/\\*`, end: blockEnd,
            beginCaptures: { 0: capture('punctuation.definition.comment.begin.typoscript') },
            endCaptures: { 0: capture('punctuation.definition.comment.end.typoscript') },
            patterns: legacy ? [{ include: '#imports' }] : []
          },
          { name: 'comment.line.double-slash.typoscript', match: `${commentStart}//.*$` },
          { name: 'comment.line.number-sign.typoscript', match: `${commentStart}#.*$` }
        ]
      },
      constants: {
        name: 'constant.other.typoscript', match: `\\{\\$${objectPath}\\}`
      },
      brackets: {
        begin: '\\[', end: '\\]|$',
        patterns: [...quoted, { include: '#constants' }, { include: '#brackets' }]
      },
      arguments: {
        name: 'string.value.typoscript', begin: '\\(', end: '\\)|$',
        beginCaptures: { 0: capture('punctuation.section.arguments.begin.typoscript') },
        endCaptures: { 0: capture('punctuation.section.arguments.end.typoscript') },
        patterns: [...quoted, { include: '#constants' }, { include: '#arguments' }]
      },
      imports: {
        patterns: [
          {
            name: 'meta.import.typoscript', begin: `${start}(@import)\\b`, end: '$',
            beginCaptures: { 1: capture('keyword.control.import.typoscript') },
            patterns: [
              ...quoted.map((rule) => ({ ...rule, name: 'string.path.typoscript' })),
              { include: '#comments' }
            ]
          },
          {
            name: 'meta.import.typoscript', begin: `${start}(<INCLUDE_TYPOSCRIPT:)`, end: '>|$',
            beginCaptures: { 1: capture('keyword.control.import.typoscript') },
            endCaptures: { 0: capture('punctuation.definition.tag.end.typoscript') },
            patterns: [
              ...quoted.map((rule) => ({ ...rule, name: 'string.path.typoscript' })),
              { name: 'entity.other.attribute-name.typoscript', match: '\\b(?:source|extensions)\\b' }
            ]
          }
        ]
      },
      statements: {
        patterns: [
          { include: '#imports' },
          {
            name: 'string.value.multiline.typoscript',
            begin: `${start}(${objectPath})[ \\t]*(\\()`,
            beginCaptures: {
              1: capture('variable.parameter.typoscript'),
              2: capture('punctuation.definition.string.begin.typoscript')
            },
            end: legacy ? '^[ \\t]*(\\))(.*)$' : '^[ \\t]*(\\))',
            endCaptures: {
              1: capture('punctuation.definition.string.end.typoscript'),
              ...(legacy ? { 2: capture('comment.line.ignored.typoscript') } : {})
            },
            contentName: 'string.value.typoscript',
            patterns: [{ include: '#constants' }]
          },
          {
            name: 'keyword.control.endblock.typoscript',
            match: `${start}\\[(?i:END|GLOBAL)\\]`
          },
          {
            name: 'keyword.control.else.typoscript', match: `${start}\\[(?i:ELSE)\\]`
          },
          {
            name: 'keyword.control.block.typoscript', begin: `${start}(\\[)`, end: '(\\])|$',
            beginCaptures: { 1: capture('punctuation.section.condition.begin.typoscript') },
            endCaptures: { 1: capture('punctuation.section.condition.end.typoscript') },
            patterns: [...quoted, { include: '#constants' }, { include: '#brackets' }]
          },
          {
            name: 'meta.reference.typoscript',
            match: `${start}(${objectPath})[ \\t]*(=<|<)[ \\t]*(${objectPath})`,
            captures: {
              1: capture('variable.parameter.typoscript'),
              2: capture('keyword.operator.reference.typoscript'),
              3: capture('variable.other.reference.typoscript')
            }
          },
          {
            name: 'meta.modification.typoscript',
            begin: `${start}(${objectPath})[ \\t]*(:=)[ \\t]*([a-zA-Z][a-zA-Z0-9_]*)?`, end: '$',
            beginCaptures: {
              1: capture('variable.parameter.typoscript'),
              2: capture('keyword.operator.modification.typoscript'),
              3: capture('support.function.typoscript')
            },
            patterns: [{ include: '#arguments' }, { include: '#comments' }]
          },
          {
            name: 'entity.name.assignment.typoscript',
            begin: `${start}(${objectPath})[ \\t]*(=)`, end: '$',
            beginCaptures: {
              1: capture('variable.parameter.typoscript'),
              2: capture('keyword.operator.equals.typoscript')
            },
            contentName: 'string.value.typoscript',
            patterns: [{ include: '#constants' }]
          },
          {
            name: 'meta.unset.typoscript',
            begin: `${start}(${objectPath})[ \\t]*(>)`, end: '$',
            beginCaptures: {
              1: capture('variable.parameter.typoscript'),
              2: capture('keyword.operator.unset.typoscript')
            },
            contentName: 'comment.line.ignored.typoscript', patterns: [{ include: '#comments' }]
          },
          {
            name: 'meta.block.typoscript',
            match: `${start}(?:(${objectPath})[ \\t]*)?(\\{|\\})`,
            captures: {
              1: capture('variable.parameter.typoscript'),
              2: capture('punctuation.section.block.typoscript')
            }
          }
        ]
      }
    }
  };
}

const outputs = {
  'typoscript.tmLanguage.json': createGrammar(false),
  'typoscript-v11.tmLanguage.json': createGrammar(true)
};
const check = process.argv.includes('--check');
for (const [name, grammar] of Object.entries(outputs)) {
  const destination = path.join(__dirname, '..', 'syntaxes', name);
  const text = `${JSON.stringify(grammar, null, 2)}\n`;
  if (check) {
    if (fs.readFileSync(destination, 'utf8') !== text) {
      console.error(`${name} is outdated. Run npm run build:grammars.`);
      process.exitCode = 1;
    }
  } else fs.writeFileSync(destination, text);
}
