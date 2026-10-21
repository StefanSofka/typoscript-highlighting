const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setupProject } = require('./helpers/project');
const { Uri } = require('./helpers/editor');
const { orderSets } = require('../lib/site-sets');
const { inspectSettings, inspectConfig, validateSetting } = require('../lib/site-settings');
const { parse } = require('../lib/parser');

function fixture(t, info = {}, state) {
  const env = setupProject(t, info, state), { editor } = env;
  const base = info.installation === 'classic' ? '/site/www/typo3conf/ext/site' : '/site/packages/site';
  if (info.installation !== 'classic') editor.put(base + '/composer.json', { type: 'typo3-cms-extension', name: 'vendor/site' });
  const set = (folder, name, rest = '', files = {}) => {
    const dir = `${base}/Configuration/Sets/${folder}`;
    editor.put(dir + '/config.yaml', `name: ${name}\nlabel: ${folder}\n${rest}`);
    for (const [file, contents] of Object.entries(files)) editor.put(dir + '/' + file, contents);
    return dir;
  };
  const site = (id, deps, settings, inline = '') => {
    const dir = info.installation === 'classic' ? `/site/www/typo3conf/sites/${id}` : `/site/config/sites/${id}`;
    editor.put(dir + '/config.yaml', `websiteTitle: ${id}\ndependencies: [${deps.join(', ')}]\n${inline}`);
    if (settings !== undefined) editor.put(dir + '/settings.yaml', settings);
    return dir;
  };
  return { ...env, set, site, base };
}
const titleSchema = 'settings:\n  site.title:\n    type: string\n    default: Default title\n    label: Website title\n';
const effective = (data, key) => data.effective.find((node) => node.path === key)?.rawValue;

test('registry order is deterministic across dependency diamonds and independent sets', () => {
  const graph = new Map([
    ['vendor/site', ['vendor/right', 'vendor/left']], ['vendor/left', ['vendor/base']], ['vendor/right', ['vendor/base']], ['vendor/base', []], ['vendor/unused', []]
  ].map(([name, deps]) => [name, { name, references: deps.map((name) => ({ name })) }]));
  const ordered = orderSets(graph).map((set) => set.name);
  assert.deepEqual(ordered, ['vendor/base', 'vendor/left', 'vendor/right', 'vendor/site', 'vendor/unused']);
  assert.deepEqual(orderSets(new Map([...graph].reverse())).map((set) => set.name), ordered);
});

for (const installation of ['composer', 'classic']) test(`${installation}: site closure, implicit files and unused-set isolation`, async (t) => {
  const env = fixture(t, { installation, webRoot: Uri.file('/site/www') }), { editor, project, document, set, site } = env;
  const base = set('Base', 'vendor/base', '', { 'constants.typoscript': 'site.legacy = Base', 'setup.typoscript': 'lib.base = TEXT', 'page.tsconfig': 'TCEMAIN.table = 1', 'settings.definitions.yaml': titleSchema });
  set('Main', 'vendor/main', 'dependencies: [vendor/base]\noptionalDependencies: [vendor/absent]', { 'setup.typoscript': 'lib.main =< lib.base' });
  set('Unused', 'vendor/unused', '', { 'settings.yaml': 'unused.secret: hidden', 'constants.typoscript': 'unused.constant = No', 'setup.typoscript': 'lib.unused = TEXT' });
  const siteDir = site('main', ['vendor/main'], 'site.title: Site title');
  const inactiveSite = installation === 'composer' ? '/site/www/typo3conf/sites/inactive' : '/site/config/sites/inactive';
  editor.put(inactiveSite + '/config.yaml', 'dependencies: [vendor/unused]');
  editor.put(inactiveSite + '/settings.yaml', 'site.title: Inactive installation');
  editor.put(siteDir + '/setup.typoscript', 'lib.site = TEXT');
  editor.put(siteDir + '/constants.typoscript', 'site.local = Local');
  editor.put(siteDir + '/page.tsconfig', 'TCEMAIN.site = 1');
  const scope = await project.siteSets.context(document);
  assert.deepEqual(scope.sets.map((set) => set.name), ['vendor/base', 'vendor/main']);
  assert.equal(scope.site.id, 'main');
  assert.deepEqual(scope.registry.sites.map((site) => site.id), ['main'], 'Only the detected installation supplies sites');
  const definitions = await project.constantDefinitions(document);
  assert.ok(definitions.some((node) => node.path === 'lib.base' && node.uri.path === base + '/setup.typoscript'));
  assert.ok(definitions.some((node) => node.path === 'site.legacy'));
  assert.ok(definitions.some((node) => node.path === 'lib.site' && node.uri.path === siteDir + '/setup.typoscript'));
  assert.ok(definitions.some((node) => node.path === 'site.local'));
  assert.ok(!definitions.some((node) => node.path.startsWith('unused.')));
  assert.ok(!definitions.some((node) => node.path === 'TCEMAIN.table'));
  assert.ok(!(await project.allSources(document)).some((entry) => entry.uri.path.includes('/Unused/')));
  const tsconfig = editor.document('/site/page.tsconfig', 'typoscript-v12');
  const pageDefinitions = await project.constantDefinitions(tsconfig);
  assert.ok(pageDefinitions.some((node) => node.path === 'TCEMAIN.table'));
  assert.ok(pageDefinitions.some((node) => node.path === 'TCEMAIN.site'));
  assert.ok(!pageDefinitions.some((node) => node.path === 'lib.base'));
});

test('each set provider applies defaults then its own values; site settings replace inline site values', async (t) => {
  const { project, document, set, site, editor } = fixture(t);
  set('Base', 'vendor/base', '', { 'settings.definitions.yaml': titleSchema, 'settings.yaml': 'site.title: Base override\nbase.only: Value' });
  set('Main', 'vendor/main', 'dependencies: [vendor/base]', { 'settings.definitions.yaml': titleSchema.replace('Default title', 'Main default') });
  const main = site('main', ['vendor/main'], 'site.other: Local', 'settings:\n  site.title: Ignored inline\n');
  let data = await project.siteSets.settings(document);
  assert.equal(effective(data, 'site.title'), 'Main default');
  assert.equal(effective(data, 'site.other'), 'Local');
  assert.equal(data.definitions.filter((node) => node.path === 'site.title' && node.effective).length, 1);
  editor.files.delete(`file://${main}/settings.yaml`); project.clear();
  data = await project.siteSets.settings(document);
  assert.equal(effective(data, 'site.title'), 'Ignored inline');
});

test('shared sets have isolated automatic context and an optional persisted site selection', async (t) => {
  const saved = new Map(), state = { get: (key, fallback) => saved.get(key) || fallback, update: async (key, value) => saved.set(key, value) };
  const { project, editor, document, set, site } = fixture(t, {}, state);
  const shared = set('Shared', 'vendor/shared', '', { 'settings.definitions.yaml': titleSchema });
  const first = site('first', ['vendor/shared'], 'site.title: First'), second = site('second', ['vendor/shared'], 'site.title: Second');
  const sharedDocument = editor.document(shared + '/setup.typoscript', 'typoscript-v12');
  assert.equal((await project.siteSets.context(document)).kind, 'ambiguous');
  assert.equal(effective(await project.siteSets.settings(sharedDocument), 'site.title'), 'Default title');
  await project.siteSets.select(sharedDocument, Uri.file(second));
  assert.equal(effective(await project.siteSets.settings(sharedDocument), 'site.title'), 'Second');
  const firstDocument = editor.document(first + '/settings.yaml', 'yaml'); firstDocument.text = 'site.title: Unsaved First';
  project.clear();
  assert.equal(effective(await project.siteSets.settings(firstDocument), 'site.title'), 'Unsaved First', 'physical site wins over persisted choice');
  assert.equal(Object.values(saved.get('typoscriptHighlighting.siteContexts'))[0], `file://${second}`);
  await project.siteSets.select(sharedDocument);
  assert.equal(effective(await project.siteSets.settings(sharedDocument), 'site.title'), 'Default title');
});

test('missing, duplicate and cyclic required sets report errors without hanging or loading invalid providers', async (t) => {
  const { project, document, set, site } = fixture(t);
  set('A', 'vendor/a', 'dependencies: [vendor/b]'); set('B', 'vendor/b', 'dependencies: [vendor/a]');
  set('Missing', 'vendor/missing', 'dependencies: [vendor/absent]');
  set('DuplicateA', 'vendor/duplicate'); set('DuplicateB', 'vendor/duplicate');
  set('Dependent', 'vendor/dependent', 'dependencies: [vendor/missing]');
  site('main', ['vendor/a', 'vendor/dependent', 'vendor/duplicate']);
  const data = await project.siteSets.settings(document);
  assert.equal(data.context.sets.length, 0);
  const issues = [...data.issues.values()].flat();
  assert.ok(issues.some((issue) => issue.code === 'cyclic-set'));
  assert.equal(issues.filter((issue) => issue.code === 'duplicate-set').length, 2);
  assert.ok(issues.some((issue) => issue.code === 'missing-set' && issue.message.includes('vendor/absent')));
});

test('optional cycles are resolved deterministically; missing optional dependencies are allowed', async (t) => {
  const { project, document, set, site } = fixture(t);
  set('A', 'vendor/a', 'optionalDependencies: [vendor/b, vendor/absent]');
  set('B', 'vendor/b', 'optionalDependencies: [vendor/a]');
  site('main', ['vendor/a']);
  const data = await project.siteSets.settings(document);
  assert.deepEqual(data.context.sets.map((set) => set.name), ['vendor/b', 'vendor/a']);
  assert.deepEqual([...data.issues.values()].flat(), []);
});

test('relative, EXT, absolute and wildcard YAML imports respect local overrides, missing flags and cycles', async (t) => {
  const { project, document, editor, set, site, base } = fixture(t);
  set('Main', 'vendor/main', '', { 'settings.definitions.yaml': titleSchema,
    'settings.yaml': 'imports:\n  - resource: ../../Shared/*.yaml\n    glob: true\n  - resource: EXT:site/Configuration/extra.yaml\n  - resource: /site/global.yaml\n  - resource: missing.yaml\n    ignore_missing: true\nsite.title: Main local' });
  editor.put(base + '/Configuration/Shared/20-last.yaml', 'shared.value: Last');
  editor.put(base + '/Configuration/Shared/10-first.yaml', 'shared.value: First');
  editor.put(base + '/Configuration/extra.yaml', 'extension.value: EXT');
  editor.put('/site/global.yaml', 'absolute.value: Absolute');
  const main = site('main', ['vendor/main'], 'imports:\n  - resource: partial.yaml\n  - resource: not-found.yaml\nsite.title: Site local');
  editor.put(main + '/partial.yaml', 'imports:\n  - resource: settings.yaml\nimported.value: Imported');
  const data = await project.siteSets.settings(document);
  assert.equal(effective(data, 'site.title'), 'Site local');
  assert.equal(effective(data, 'shared.value'), 'Last');
  assert.equal(effective(data, 'extension.value'), 'EXT');
  assert.equal(effective(data, 'absolute.value'), 'Absolute');
  assert.equal(effective(data, 'imported.value'), 'Imported');
  const issues = [...data.issues.values()].flat();
  assert.equal(issues.filter((issue) => issue.code === 'yaml-import').length, 1);
  assert.ok(issues.some((issue) => issue.code === 'cyclic-yaml-import'));
  const yaml = editor.document(main + '/partial.yaml', 'yaml'); yaml.text = 'imported.value: Unsaved';
  editor.events.text.fire({ document: yaml });
  assert.equal(effective(await project.siteSets.settings(document), 'imported.value'), 'Unsaved');
  editor.documents.splice(editor.documents.indexOf(yaml), 1); editor.events.close.fire(yaml);
  assert.equal(effective(await project.siteSets.settings(document), 'imported.value'), 'Imported');
});

test('list defaults, enums, readonly overrides and invalid typed values carry useful metadata', async (t) => {
  const { project, document, set, site } = fixture(t);
  set('Main', 'vendor/main', '', { 'settings.definitions.yaml': 'settings:\n  site.items:\n    type: stringlist\n    default: [one, two]\n  site.mode:\n    type: string\n    default: light\n    enum:\n      light: Light\n      dark: Dark\n  site.title:\n    type: string\n    default: Default\n    readonly: true\n  site.enabled:\n    type: bool\n    default: false\n' });
  site('main', ['vendor/main'], 'site.mode: invalid\nsite.title: Manual override\nsite.enabled: []');
  const data = await project.siteSets.settings(document);
  assert.deepEqual(effective(data, 'site.items'), ['one', 'two']);
  assert.equal(effective(data, 'site.mode'), 'invalid', 'enum warnings are advisory; PHP string validation still accepts the raw value');
  assert.equal(effective(data, 'site.enabled'), false);
  assert.equal(effective(data, 'site.title'), 'Manual override');
  assert.equal(data.schemas.get('site.title').readonly, true);
  assert.equal([...data.issues.values()].flat().filter((issue) => issue.code === 'setting-value').length, 2);
});

test('standalone sets work without Composer; dependencies use declared names, not folder or package names', async (t) => {
  const { project, document, editor } = setupProject(t);
  editor.put('/site/Configuration/Sets/Folder/config.yaml', 'name: another-vendor/actual-name\nlabel: Standalone\n');
  editor.put('/site/Configuration/Sets/Folder/settings.definitions.yaml', titleSchema);
  const source = editor.document('/site/Configuration/Sets/Folder/setup.typoscript', 'typoscript-v12');
  assert.equal(effective(await project.siteSets.settings(source), 'site.title'), 'Default title');
  assert.equal((await project.siteSets.context(document)).sets.length, 0, 'unselected standalone sets do not leak');
});

test('YAML diagnostics reject malformed configs and forbidden definition imports with exact ranges', () => {
  const config = inspectConfig('name: vendor/main\ndependencies: vendor/base\nimports: [other.yaml]');
  assert.ok(config.issues.some((issue) => issue.code === 'set-dependencies' && issue.line === 1));
  assert.ok(config.issues.some((issue) => issue.code === 'set-config-import' && issue.line === 2));
  const schema = inspectSettings('imports: [other.yaml]\nsettings:\n  site.title:\n    type: typo\n', '/settings.definitions.yaml');
  assert.deepEqual(new Set(schema.issues.map((issue) => issue.code)), new Set(['definition-import', 'setting-type', 'setting-default']));
  assert.match(validateSetting({ settingType: 'int' }, { path: 'site.count', rawValue: 'invalid' }), /expects int/);
  assert.equal(validateSetting({ settingType: 'int' }, { path: 'site.count', rawValue: '%env(COUNT)%' }), undefined);
});

test('direct siteSettings getters and insertData references have key ranges without matching literal text', () => {
  const parsed = parse('page.10.data = siteSettings:site.title\npage.20.value = {siteSettings:site.title}\npage.30.value = siteSettings:not.a.getter\n# page.40.data = siteSettings:comment\npage.50.value (\n  <h1>{siteSettings:site.title}</h1>\n)\n');
  assert.deepEqual(parsed.references.map((ref) => ref.name), ['site.title', 'site.title', 'site.title']);
  for (const ref of parsed.references) assert.equal(parsed.lines[ref.line].slice(ref.start, ref.end), 'site.title');
});
