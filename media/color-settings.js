/* global acquireVsCodeApi */
(() => {
  const vscode = acquireVsCodeApi();
  const list = document.getElementById('colors');
  const themeSelect = document.getElementById('theme');
  const save = document.getElementById('save');
  const status = document.getElementById('status');
  const rows = new Map();
  let themes = [];
  let selected;
  let persistedTheme;
  let customDraft = {};
  let dirty = false;
  let pending;
  let sequence = 0;

  function snapshot() {
    return Object.fromEntries([...rows].map(([category, { input, picker }]) => [category,
      { text: input.value, color: picker.value.toUpperCase(), invalid: input.getAttribute('aria-invalid') === 'true' }]));
  }
  function loadColors(colors) {
    for (const [category, { input, picker }] of rows) {
      const value = colors[category];
      if (!value) continue;
      input.value = typeof value === 'string' ? value : value.text;
      picker.value = typeof value === 'string' ? value : value.color;
      input.setAttribute('aria-invalid', String(!!value.invalid));
    }
  }
  function showSelection() {
    loadColors(selected === 'custom' ? customDraft : themes.find(({ id }) => id === selected)?.colors || {});
  }
  function preview() {
    themeSelect.value = selected;
    themeSelect.disabled = !!pending;
    for (const { input, picker } of rows.values()) { input.disabled = !!pending; picker.disabled = !!pending; }
    for (const node of document.querySelectorAll('[data-color]')) {
      node.style.color = rows.get(node.dataset.color)?.picker.value || 'var(--vscode-editor-foreground)';
    }
    save.disabled = !!pending || selected !== 'custom' || !rows.size
      || [...rows.values()].some(({ input }) => input.getAttribute('aria-invalid') === 'true');
  }
  function changed(row, value) {
    const valid = /^#?[0-9a-f]{6}$/i.test(value);
    row.input.setAttribute('aria-invalid', String(!valid));
    if (valid) row.picker.value = `#${value.replace(/^#/, '')}`;
    selected = 'custom';
    customDraft = snapshot();
    dirty = true;
    status.textContent = valid ? 'Preview updated' : 'Enter a six-digit color, for example #569CD6.';
    preview();
  }
  function build(colors) {
    for (const entry of colors) {
      const container = document.createElement('div');
      container.className = 'color-row'; container.dataset.category = entry.category;
      const label = document.createElement('label');
      label.textContent = entry.label; label.htmlFor = `hex-${entry.category}`;
      const picker = document.createElement('input');
      picker.type = 'color'; picker.value = entry.color;
      picker.setAttribute('aria-label', `Choose ${entry.label.toLowerCase()} color`);
      const input = document.createElement('input');
      input.type = 'text'; input.value = entry.color; input.id = label.htmlFor;
      input.spellcheck = false; input.autocomplete = 'off';
      input.setAttribute('aria-label', `${entry.label} hex color`);
      const row = { container, input, picker };
      picker.addEventListener('input', () => { input.value = picker.value.toUpperCase(); changed(row, input.value); });
      input.addEventListener('input', () => changed(row, input.value.trim()));
      input.addEventListener('blur', () => {
        if (input.getAttribute('aria-invalid') !== 'true') {
          input.value = picker.value.toUpperCase();
          if (dirty && selected === 'custom') customDraft = snapshot();
        }
      });
      container.append(label, picker, input); list.append(container); rows.set(entry.category, row);
    }
  }
  themeSelect.addEventListener('change', () => {
    const previousSelection = selected;
    const previousColors = snapshot();
    if (selected === 'custom') customDraft = previousColors;
    selected = themeSelect.value;
    status.textContent = '';
    showSelection();
    if (selected !== 'custom') {
      pending = { id: ++sequence, operation: 'theme', previousSelection, previousColors };
      status.textContent = 'Applying theme…';
      vscode.postMessage({ type: 'theme', theme: selected, id: pending.id });
    }
    preview();
  });
  save.addEventListener('click', () => {
    if (save.disabled) return;
    customDraft = snapshot();
    pending = { id: ++sequence, operation: 'save' };
    status.textContent = 'Saving…'; preview();
    vscode.postMessage({ type: 'save', id: pending.id,
      colors: Object.fromEntries([...rows].map(([category, { picker }]) => [category, picker.value.toUpperCase()])) });
  });
  window.addEventListener('message', ({ data }) => {
    if (!data || typeof data !== 'object') return;
    if (data.type === 'state') {
      if (!rows.size) build(data.colors);
      if (!dirty && !pending) customDraft = Object.fromEntries(data.colors.map(({ category, color }) => [category, color]));
      themes = data.themes;
      themeSelect.replaceChildren(...themes.map(({ id, label }) => {
        const option = document.createElement('option'); option.value = id; option.textContent = label; return option;
      }));
      if (selected === undefined) selected = data.theme;
      else if (!pending && persistedTheme !== undefined && persistedTheme !== data.theme) { selected = data.theme; status.textContent = ''; }
      persistedTheme = data.theme;
      if (!pending) showSelection();
      document.getElementById('location').textContent = data.location;
      if (data.category && rows.has(data.category)) rows.get(data.category).input.focus();
      if (status.textContent === 'Loading…') status.textContent = '';
      preview();
    } else if (data.type === 'saved' && data.id === pending?.id) {
      const operation = pending.operation;
      pending = undefined;
      if (operation === 'save') { dirty = false; selected = 'custom'; persistedTheme = 'custom'; }
      status.textContent = operation === 'save' ? 'Custom theme saved' : 'Theme applied';
      preview();
    } else if (data.type === 'error' && data.id === pending?.id) {
      const { operation, previousSelection, previousColors } = pending;
      pending = undefined;
      if (operation === 'theme') { selected = previousSelection || persistedTheme || 'auto'; loadColors(previousColors); }
      status.textContent = data.message;
      preview();
    }
  });
  vscode.postMessage({ type: 'ready' });
})();
