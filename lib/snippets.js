const SNIPPETS = [
  { name: 'Object block', prefix: 'block', scope: 'all', body: '${1:lib.example} {\n\t$0\n}' },
  { name: 'Multiline value', prefix: 'multiline', scope: 'all', body: '${1:lib.example.value} (\n$0\n)' },
  { name: 'Import TypoScript', prefix: 'import', scope: 'all', body: '@import \'${1:./setup.typoscript}\'' },
  { name: 'Condition', prefix: 'condition', scope: 'all', body: '[${1:site("identifier") == "main"}]\n\t$0\n[END]' },
  { name: 'TEXT content object', prefix: 'text', scope: 'setup', body: '${1:lib.example} = TEXT\n${1:lib.example}.value = ${2:Hello TYPO3!}$0' },
  { name: 'COA content object', prefix: 'coa', scope: 'setup', body: '${1:lib.example} = COA\n${1:lib.example} {\n\t10 = TEXT\n\t10.value = ${2:Hello TYPO3!}\n\t$0\n}' },
  { name: 'Fluid template', prefix: 'fluid', scope: 'setup', body: '${1:page.10} = FLUIDTEMPLATE\n${1:page.10} {\n\ttemplateName = ${2:Default}\n\ttemplateRootPaths.10 = EXT:${3:site_package}/Resources/Private/Templates/\n\tpartialRootPaths.10 = EXT:${3:site_package}/Resources/Private/Partials/\n\tlayoutRootPaths.10 = EXT:${3:site_package}/Resources/Private/Layouts/\n\t$0\n}' },
  { name: 'Page TSconfig form override', prefix: 'tceform', scope: 'tsconfig', body: 'TCEFORM.${1:tt_content}.${2:header} {\n\tdisabled = ${3:1}\n\t$0\n}' },
  { name: 'Page TSconfig defaults', prefix: 'tcedefaults', scope: 'tsconfig', body: 'TCAdefaults.${1:tt_content}.${2:header} = ${3:Default}$0' }
];
module.exports = { SNIPPETS };
