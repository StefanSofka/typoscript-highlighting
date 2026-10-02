/* global acquireVsCodeApi */
(() => {
  const vscode = acquireVsCodeApi();
  const categories = document.getElementById('categories');
  const scope = document.getElementById('scope');
  const status = document.getElementById('status');
  const spectrum = document.getElementById('spectrum');
  const hue = document.getElementById('hue');
  const rows = new Map();
  const pending = new Map();
  const timers = new Map();
  let colors = [];
  let targetId;
  let selected = 'comments';
  let sequence = 0;
  let hsv = { h: 207, s: .6, v: .84 };
  let dragging = false;

  function hexToHsv(hex) {
    const [r, g, b] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
    let h = hsv.h;
    if (delta) {
      if (max === r) h = 60 * (((g - b) / delta) % 6);
      else if (max === g) h = 60 * ((b - r) / delta + 2);
      else h = 60 * ((r - g) / delta + 4);
    }
    return { h: (h + 360) % 360, s: max ? delta / max : 0, v: max };
  }

  function hsvToHex({ h, s, v }) {
    const channel = (offset) => {
      const k = (offset + h / 60) % 6;
      return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))))
        .toString(16).padStart(2, '0');
    };
    return `#${channel(5)}${channel(3)}${channel(1)}`.toUpperCase();
  }

  function renderPicker(syncHsv = true) {
    const entry = colors.find((item) => item.category === selected);
    if (!entry) return;
    if (syncHsv) hsv = hexToHsv(entry.color || '#569CD6');
    document.getElementById('picker-title').textContent = entry.label;
    document.getElementById('picker-help').textContent = entry.color
      ? 'Changes save automatically and apply to open TypoScript editors.'
      : 'System Default. Choose a color or enter a hex code to override the theme.';
    spectrum.style.backgroundColor = `hsl(${hsv.h}, 100%, 50%)`;
    spectrum.setAttribute('aria-valuenow', Math.round(hsv.s * 100));
    spectrum.setAttribute('aria-valuetext', `Saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`);
    const marker = document.getElementById('marker');
    marker.style.left = `${hsv.s * 100}%`;
    marker.style.top = `${(1 - hsv.v) * 100}%`;
    hue.value = Math.round(hsv.h);
    document.getElementById('preview').style.backgroundColor = entry.color || 'transparent';
    document.getElementById('color-value').textContent = entry.color || 'System Default';
    for (const [category, row] of rows) row.container.classList.toggle('selected', category === selected);
  }

  function select(category) {
    selected = category;
    renderPicker();
  }

  function renderRow(entry) {
    const row = rows.get(entry.category);
    if (document.activeElement !== row.input) row.input.value = entry.color;
    row.swatch.style.backgroundColor = entry.color || '';
    row.swatch.classList.toggle('default', !entry.color);
    row.swatch.title = entry.color || 'System Default';
    row.reset.disabled = !entry.color && !row.input.value;
  }

  function flush(category) {
    clearTimeout(timers.get(category));
    timers.delete(category);
    const change = pending.get(category);
    if (!change || change.sent) return;
    change.sent = true;
    vscode.postMessage({ type: 'color', category, color: change.color, id: change.id });
  }

  function changeColor(category, color, immediate = false, keepHsv = false) {
    const entry = colors.find((item) => item.category === category);
    if (!entry) return;
    entry.color = color;
    const row = rows.get(category);
    row.input.value = color;
    row.input.setAttribute('aria-invalid', 'false');
    row.error.textContent = '';
    pending.set(category, { id: ++sequence, color, sent: false });
    status.textContent = 'Saving…';
    renderRow(entry);
    renderPicker(!keepHsv);
    clearTimeout(timers.get(category));
    if (immediate) flush(category);
    else timers.set(category, setTimeout(() => flush(category), 120));
  }

  function fromHex(category) {
    const row = rows.get(category);
    const value = row.input.value.trim();
    if (value && !/^#?[0-9a-f]{6}$/i.test(value)) {
      row.input.setAttribute('aria-invalid', 'true');
      row.error.textContent = 'Enter a six-digit hex color, for example #569CD6.';
      row.reset.disabled = false;
      // A partial or invalid edit must not save an earlier valid draft later.
      clearTimeout(timers.get(category));
      timers.delete(category);
      if (!pending.get(category)?.sent) pending.delete(category);
      if (!pending.size) status.textContent = 'Enter a valid hex color to save';
      return;
    }
    changeColor(category, value ? `#${value.replace(/^#/, '')}`.toUpperCase() : '');
  }

  function buildRows() {
    for (const entry of colors) {
      const container = document.createElement('div');
      container.className = 'row';
      container.dataset.category = entry.category;
      const copy = document.createElement('div');
      const label = document.createElement('label');
      label.className = 'label';
      label.htmlFor = `hex-${entry.category}`;
      label.textContent = entry.label;
      const description = document.createElement('div');
      description.className = 'description';
      description.textContent = entry.description;
      copy.append(label, description);
      const swatch = document.createElement('button');
      swatch.className = 'swatch';
      swatch.setAttribute('aria-label', `Choose ${entry.label.toLowerCase()} color`);
      swatch.addEventListener('click', () => {
        select(entry.category);
        document.querySelector('.picker').scrollIntoView({ block: 'nearest' });
        spectrum.focus({ preventScroll: true });
      });
      const input = document.createElement('input');
      input.type = 'text';
      input.id = label.htmlFor;
      input.placeholder = 'System Default';
      input.spellcheck = false;
      input.autocomplete = 'off';
      input.setAttribute('aria-describedby', `error-${entry.category}`);
      input.addEventListener('focus', () => select(entry.category));
      input.addEventListener('input', () => fromHex(entry.category));
      input.addEventListener('change', () => { if (input.getAttribute('aria-invalid') !== 'true') flush(entry.category); });
      const reset = document.createElement('button');
      reset.className = 'reset';
      reset.textContent = 'System Default';
      reset.setAttribute('aria-label', `Reset ${entry.label.toLowerCase()} to System Default`);
      reset.addEventListener('click', () => { select(entry.category); changeColor(entry.category, '', true); });
      const error = document.createElement('div');
      error.className = 'error';
      error.id = `error-${entry.category}`;
      error.setAttribute('aria-live', 'polite');
      container.append(copy, swatch, input, reset, error);
      rows.set(entry.category, { container, swatch, input, reset, error });
      categories.append(container);
    }
  }

  function updateSpectrum(event) {
    const rect = spectrum.getBoundingClientRect();
    hsv.s = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    hsv.v = 1 - Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    changeColor(selected, hsvToHex(hsv), false, true);
  }
  spectrum.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    spectrum.focus();
    dragging = true;
    spectrum.setPointerCapture(event.pointerId);
    updateSpectrum(event);
  });
  spectrum.addEventListener('pointermove', (event) => { if (dragging) updateSpectrum(event); });
  for (const event of ['pointerup', 'pointercancel']) spectrum.addEventListener(event, () => {
    if (!dragging) return;
    dragging = false;
    flush(selected);
  });
  spectrum.addEventListener('keydown', (event) => {
    const delta = event.shiftKey ? .1 : .01;
    if (event.key === 'ArrowRight') hsv.s = Math.min(1, hsv.s + delta);
    else if (event.key === 'ArrowLeft') hsv.s = Math.max(0, hsv.s - delta);
    else if (event.key === 'ArrowUp') hsv.v = Math.min(1, hsv.v + delta);
    else if (event.key === 'ArrowDown') hsv.v = Math.max(0, hsv.v - delta);
    else return;
    event.preventDefault();
    changeColor(selected, hsvToHex(hsv), false, true);
  });
  hue.addEventListener('input', () => {
    hsv.h = Number(hue.value);
    changeColor(selected, hsvToHex(hsv), false, true);
  });
  hue.addEventListener('change', () => flush(selected));
  scope.addEventListener('change', () => {
    for (const category of pending.keys()) flush(category);
    pending.clear();
    for (const row of rows.values()) { row.input.setAttribute('aria-invalid', 'false'); row.error.textContent = ''; }
    vscode.postMessage({ type: 'target', targetId: scope.value });
  });

  window.addEventListener('message', ({ data }) => {
    if (data.type === 'state') {
      const changedTarget = targetId !== data.targetId;
      targetId = data.targetId;
      if (changedTarget) pending.clear();
      const focused = document.activeElement;
      scope.replaceChildren(...data.targets.map((target) => {
        const option = document.createElement('option');
        option.value = target.id;
        option.textContent = target.label;
        return option;
      }));
      scope.value = targetId;
      colors = data.colors.map((entry) => ({ ...entry, color: pending.get(entry.category)?.color ?? entry.color }));
      if (!rows.size) buildRows();
      if (data.category && rows.has(data.category)) selected = data.category;
      for (const entry of colors) {
        if (changedTarget && focused === rows.get(entry.category).input) focused.value = entry.color;
        renderRow(entry);
      }
      if (!dragging && focused !== hue) renderPicker();
      if (!pending.size) status.textContent = 'Changes save automatically';
    } else if (data.type === 'saved' && data.targetId === targetId) {
      if (pending.get(data.category)?.id === data.id) pending.delete(data.category);
      if (!pending.size) status.textContent = 'Saved';
    } else if (data.type === 'error' && data.targetId === targetId) {
      if (pending.get(data.category)?.id === data.id) pending.delete(data.category);
      status.textContent = data.message;
    }
  });
  vscode.postMessage({ type: 'ready' });
})();
