const LANGUAGE_IDS = ['typoscript', 'typoscript-v11', 'typoscript-v12'];
const SELECTOR = LANGUAGE_IDS.map((language) => ({ language }));
const isTypoScript = (document) => !!document && LANGUAGE_IDS.includes(document.languageId);

function targetVersion(configuration) {
  const selected = configuration.inspect?.('typo3Version');
  const explicit = selected && ['globalValue', 'workspaceValue', 'workspaceFolderValue'].some((key) => selected[key] !== undefined);
  const value = configuration.get('typo3Version', 'auto');
  return explicit || value !== 'auto' ? value : configuration.get('commentRules', 'auto');
}

module.exports = { LANGUAGE_IDS, SELECTOR, isTypoScript, targetVersion };
