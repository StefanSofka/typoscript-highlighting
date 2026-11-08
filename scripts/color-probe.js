const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(description, predicate, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try { const result = await predicate(); if (result) return result; } catch (error) { lastError = error; }
    await pause(50);
  }
  throw new Error(`Timed out: ${description}${lastError ? ` (${lastError.message})` : ''}`);
}

async function runColorProbe(directory, port, reportFile) {
  const stateFile = path.join(directory, 'color-state.json');
  const ackFile = path.join(directory, 'color-ack.json');
  const report = { stages: [], rangeChecks: 0, characterChecks: 0, imageChecks: 0 };
  const baselines = new Map();
  let socket;
  let current;
  let call;
  try {
    const target = await until('isolated editor debug endpoint', async () => {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      return targets.find((entry) => entry.type === 'page' && entry.url.includes('workbench'));
    }, 180000);
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    const pending = new Map();
    let sequence = 0;
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      const job = pending.get(message.id);
      if (!job) return;
      pending.delete(message.id);
      clearTimeout(job.timer);
      if (message.error) job.reject(new Error(JSON.stringify(message.error)));
      else job.resolve(message.result);
    });
    socket.addEventListener('close', () => {
      for (const job of pending.values()) { clearTimeout(job.timer); job.reject(new Error('Editor debug connection closed')); }
      pending.clear();
    });
    call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Debug command timed out: ${method}`)); }, 10000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
    const evaluate = async (expression, contextId, sessionId) => {
      const result = await call('Runtime.evaluate', { expression, contextId, returnByValue: true }, sessionId);
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const viewport = process.env.TYPOSCRIPT_SCREENSHOT_DIR ? [1600, 1100]
      : process.env.TYPOSCRIPT_TEST_VIEWPORT?.split('x').map(Number);
    if (viewport?.length === 2 && viewport.every((value) => Number.isSafeInteger(value) && value >= 600 && value <= 4000)) {
      await call('Emulation.setDeviceMetricsOverride', { width: viewport[0], height: viewport[1], deviceScaleFactor: 1, mobile: false });
    }
    const snapshot = async (major) => evaluate(`(() => {
      for (const group of document.querySelectorAll('.monaco-editor .view-lines')) {
        if (!group.getBoundingClientRect().width || getComputedStyle(group).visibility !== 'visible') continue;
        // Monaco reuses DOM rows after edits; DOM order is not document order.
        const lines = [...group.querySelectorAll('.view-line')]
          .sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top)).map(line => {
          const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
          const characters = [];
          while (walker.nextNode()) {
            const node = walker.currentNode;
            const color = getComputedStyle(node.parentElement).color;
            for (const char of node.textContent.replaceAll('\\u00a0', ' ')) characters.push({ char, color });
          }
          return { text: characters.map(x => x.char).join(''), characters,
            brackets: !!line.querySelector('[class*="bracket-highlighting-"]') };
        });
        if (lines.some(line => line?.text.startsWith('# TYPO3 ${major} Color comment'))) return lines;
      }
      return null;
    })()`);
    const canonical = (lines) => lines.map((line) => line.characters.filter(({ char }) => !/\s/.test(char)));
    const rgb = (hex) => `rgb(${[1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)).join(', ')})`;
    function verifyRanges(lines, checks) {
      for (const check of checks) {
        assert.ok(check.start >= 0, `${check.category}: fixture text must exist`);
        assert.equal(lines[check.line]?.text.slice(check.start, check.start + check.text.length), check.text, `line ${check.line}: ${check.text}`);
        for (let index = 0; index < check.text.length; index++) {
          if (/\s/.test(check.text[index])) continue;
          assert.equal(lines[check.line].characters[check.start + index].color, rgb(check.color), `${check.category || ''} ${check.text}[${index}]`);
        }
      }
    }
    const rendered = (data) => until(data.name || 'rendered category colors', async () => {
      const lines = await snapshot(data.major);
      if (!lines) return false;
      verifyRanges(lines, data.checks);
      return lines;
    });
    async function webviewContents(target) {
      const { sessionId } = await call('Target.attachToTarget', { targetId: target.targetId, flatten: true });
      const tree = await until('loaded webview content', async () => {
        const result = await call('Page.getFrameTree', {}, sessionId);
        return result.frameTree.childFrames?.length ? result : false;
      });
      const { executionContextId } = await call('Page.createIsolatedWorld', {
        frameId: tree.frameTree.childFrames[0].frame.id, worldName: 'typoscript-color-test'
      }, sessionId);
      return { evaluate: (expression) => evaluate(expression, executionContextId, sessionId), sessionId };
    }
    let webview;
    async function picker() {
      if (webview) return webview;
      const target = await until('color picker frame', async () => (await call('Target.getTargets')).targetInfos
        .find((entry) => entry.type === 'iframe' && entry.url.includes('stefan-sofka.typoscript-highlighting')));
      webview = (await webviewContents(target)).evaluate;
      await until('nine hex inputs', async () => (await webview(`document.querySelectorAll('.color-row input[type=text]').length`)) === 9);
      return webview;
    }
    async function verifyReadme(expectedImages) {
      const target = await until('extension README frame', async () => (await call('Target.getTargets')).targetInfos
        .find((entry) => entry.type === 'iframe' && !entry.url.includes('stefan-sofka.typoscript-highlighting')));
      const content = await webviewContents(target);
      const images = await until('all README screenshots loaded in extension Details', async () => {
        const snapshot = await content.evaluate(`({ title: document.querySelector('h1')?.textContent,
          images: [...document.querySelectorAll('img')].map(image => ({ src: image.getAttribute('src'), complete: image.complete,
            width: image.naturalWidth, height: image.naturalHeight })) })`);
        assert.equal(snapshot.title, 'TypoScript Highlighting');
        assert.equal(snapshot.images.length, expectedImages);
        assert.ok(snapshot.images.every(({ src, complete, width, height }) => /^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/(?:[0-9a-f]{40}|v\d+\.\d+\.\d+)\//.test(src)
          && complete && width >= 128 && height >= 128), JSON.stringify(snapshot.images));
        return snapshot.images;
      });
      report.imageChecks += images.length;
    }
    async function enter(ui, category, value) {
      await ui(`(() => { const input = document.getElementById('hex-${category}'); input.focus(); input.value = ${JSON.stringify(value)};
        input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    }
    async function verifyNativeSettings() {
      const allowed = ['typoscriptHighlighting.theme', 'typoscriptHighlighting.customTheme',
        'typoscriptHighlighting.diagnostics.enabled', 'typoscriptHighlighting.formatting.enabled', 'typoscriptHighlighting.typo3Version'];
      const info = await until('five compact extension settings', async () => evaluate(`(() => {
        const counts = [...document.querySelectorAll('.settings-count-widget')]
          .filter(node => node.getBoundingClientRect().width).map(node => node.textContent.trim());
        const keys = [...document.querySelectorAll('[data-key^="typoscriptHighlighting."]')].map(node => node.getAttribute('data-key'));
        return counts.some(text => /^5\\b/.test(text)) && keys.includes('typoscriptHighlighting.theme')
          && keys.includes('typoscriptHighlighting.customTheme') ? { counts, keys } : false;
      })()`));
      assert.ok(info.keys.every(key => allowed.includes(key)), `obsolete native settings must not appear: ${JSON.stringify(info.keys)}`);
      assert.equal(await evaluate(`document.querySelectorAll('[data-key="typoscriptHighlighting.customTheme"] input[type=text]').length`), 0,
        'the stored custom palette must use a compact JSON entry, not nine duplicate text fields');
    }

    let lastId = 0;
    while (true) {
      current = await until('next rendered-color scenario', async () => {
        const value = JSON.parse(await fs.readFile(stateFile, 'utf8'));
        return value.id > lastId ? value : false;
      }, 40000);
      const before = report.characterChecks;
      if (current.action === 'extension-readme') {
        await verifyReadme(current.expectedImages);
      } else if (current.action === 'extension-theme-menu') {
        const manageButton = () => evaluate(`(() => {
          const button = document.querySelector('.extension-editor .action-label.manage:not(.hide)');
          const r = button?.getBoundingClientRect();
          return r?.width && r.height ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : false;
        })()`);
        const themeMenuItem = () => evaluate(`(() => {
          const labels = [...document.querySelectorAll('.monaco-menu .action-label')];
          const button = labels.find(node => node.textContent.includes('Theme Settings'));
          const r = button?.getBoundingClientRect();
          return r?.width && r.height ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : false;
        })()`);
        const click = async (point) => {
          await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
          await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
        };
        await until('select Theme Settings from extension menu', async () => {
          const manage = await manageButton();
          if (!manage) return false;
          await click(manage);
          await until('Theme Settings in extension menu', themeMenuItem);
          if (current.menuScreenshot && process.env.TYPOSCRIPT_SCREENSHOT_DIR) {
            await fs.mkdir(process.env.TYPOSCRIPT_SCREENSHOT_DIR, { recursive: true });
            const capture = await call('Page.captureScreenshot', { format: 'png' });
            await fs.writeFile(path.join(process.env.TYPOSCRIPT_SCREENSHOT_DIR, current.menuScreenshot), Buffer.from(capture.data, 'base64'));
          }
          // Monaco enables menu mouse-up handlers after 100 ms. The workbench
          // can dismiss the menu during that delay; reopen it before retrying.
          await pause(150);
          const item = await themeMenuItem();
          if (!item) return false;
          await click(item);
          return true;
        });
        const ui = await picker();
        assert.equal(await ui(`document.querySelectorAll('input[type=color]').length`), 9);
        assert.equal(await ui(`document.getElementById('colors').hidden`), false);
      } else if (current.action === 'settings-theme') {
        await until('Theme dropdown in native Settings', async () => evaluate(`(() => {
          const row = document.querySelector('[data-key="typoscriptHighlighting.theme"]');
          const select = row?.querySelector('select');
          if (!select) return false;
          return [...select.options].map(option => option.textContent).join('|').includes('Custom');
        })()`));
        await evaluate(`(() => {
          const select = document.querySelector('[data-key="typoscriptHighlighting.theme"] select');
          const option = [...select.options].find(option => option.textContent === 'Nord');
          select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true }));
        })()`);
        await pause(300);
        await verifyNativeSettings();
      } else if (current.action === 'settings-clean') {
        await verifyNativeSettings();
      } else if (current.action === 'settings-open-theme') {
        const link = await until('Open Theme Settings link in native Settings', async () => evaluate(`(() => {
          const row = document.querySelector('[data-key="typoscriptHighlighting.theme"]');
          const node = [...(row?.querySelectorAll('a') || [])].find(node => /theme settings/i.test(node.textContent));
          const r = node?.getBoundingClientRect();
          return r?.width && r.height ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : false;
        })()`));
        await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...link, button: 'left', clickCount: 1 });
        await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...link, button: 'left', clickCount: 1 });
        webview = undefined;
        const ui = await picker();
        assert.equal(await ui(`document.querySelectorAll('input[type=color]').length`), 9);
        assert.equal(await ui(`document.getElementById('theme').value`), 'custom');
        for (const [category, color] of Object.entries(current.paletteColors)) {
          assert.equal(await ui(`document.getElementById('hex-${category}').value`), color, `native entry point keeps saved ${category}`);
        }
      } else if (current.action === 'custom-open') {
        const ui = await picker();
        assert.equal(await ui(`document.querySelectorAll('input[type=color]').length`), 9);
        assert.equal(await ui(`document.querySelectorAll('button').length`), 1);
        assert.deepEqual(await ui(`[...document.getElementById('theme').options].map(option => option.value)`), ['auto', 'dark', 'light', 'nord', 'monokai', 'solarized', 'custom']);
        assert.equal(await ui(`document.getElementById('theme').value`), 'nord');
        assert.equal(await ui(`document.getElementById('colors').hidden`), false);
        assert.equal(await ui(`document.getElementById('save').disabled`), true);
      } else if (current.action === 'custom-draft') {
        const ui = await picker();
        assert.equal(await ui(`document.querySelectorAll('input[type=color]').length`), 9);
        assert.equal(await ui(`document.querySelectorAll('button').length`), 1);
        await enter(ui, 'comments', '#XX0011');
        assert.equal(await ui(`document.getElementById('theme').value`), 'custom');
        assert.equal(await ui(`document.getElementById('save').disabled`), true);
        assert.equal(await ui(`document.getElementById('hex-comments').getAttribute('aria-invalid')`), 'true');
        for (const [category, color] of Object.entries(current.paletteColors)) await enter(ui, category, color);
        assert.equal(await ui(`document.getElementById('save').disabled`), false);
        await ui(`(() => {
          const picker = document.querySelector('[data-category="values"] input[type=color]');
          picker.value = '#1234ab'; picker.dispatchEvent(new Event('input', { bubbles: true }));
        })()`);
        assert.equal(await ui(`document.getElementById('hex-values').value`), '#1234AB');
      } else if (current.action === 'panel-theme' || current.action === 'panel-external') {
        const ui = await picker();
        if (current.action === 'panel-theme') {
          await ui(`(() => { const select = document.getElementById('theme'); select.value = ${JSON.stringify(current.theme)}; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        }
        await until('preset selected with editable color fields visible', async () => await ui(`document.getElementById('theme').value === ${JSON.stringify(current.theme)}
          && !document.getElementById('theme').disabled && !document.getElementById('colors').hidden && !document.getElementById('save').hidden`));
        const previewColors = await ui(`Object.fromEntries([...document.querySelectorAll('[data-color]')].map(node => [node.dataset.color, getComputedStyle(node).color]))`);
        for (const [category, color] of Object.entries(current.paletteColors)) {
          assert.equal(previewColors[category], rgb(color), `preset preview: ${category}`);
          assert.equal(await ui(`document.getElementById('hex-${category}').value`), color, `preset color field: ${category}`);
        }
      } else if (current.action === 'panel-custom') {
        const ui = await picker();
        await ui(`(() => { const select = document.getElementById('theme'); select.value = 'custom'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        assert.equal(await ui(`document.getElementById('colors').hidden`), false);
        for (const [category, color] of Object.entries(current.paletteColors)) assert.equal(await ui(`document.getElementById('hex-${category}').value`), color);
      } else if (current.action === 'panel-adjust-one' || current.action === 'panel-check-draft') {
        const ui = await picker();
        if (current.action === 'panel-adjust-one') await enter(ui, 'comments', current.paletteColors.comments);
        assert.equal(await ui(`document.getElementById('theme').value`), 'custom');
        assert.equal(await ui(`document.getElementById('save').disabled`), false);
        for (const [category, color] of Object.entries(current.paletteColors)) assert.equal(await ui(`document.getElementById('hex-${category}').value`), color, `customized preset: ${category}`);
      } else if (current.action === 'custom-save') {
        const ui = await picker();
        await ui(`document.getElementById('save').click()`);
        await until('custom theme saved', async () => await ui(`document.getElementById('status').textContent === 'Custom theme saved'`));
      }
      if (current.baseline) {
        let previous;
        let stableSince = Date.now();
        const lines = await until('fully tokenized, stable default document', async () => {
          const result = await snapshot(current.major);
          if (result?.length !== 16) return false;
          if (current.major !== 99) {
            if (!result[6].brackets) return false;
            const covered = result[13].characters[0].color;
            const after = result[15].characters[0].color;
            const comment = result[0].characters[0].color;
            if (current.major === 11 ? covered !== comment || covered === after : covered !== after) return false;
          }
          const serialized = JSON.stringify(canonical(result));
          if (current.differs && serialized === JSON.stringify(canonical(baselines.get(current.differs)))) return false;
          if (serialized !== previous) { previous = serialized; stableSince = Date.now(); return false; }
          return Date.now() - stableSince >= 400 ? result : false;
        });
        baselines.set(current.baseline, lines);
        report.characterChecks += canonical(lines).flat().length;
      }
      for (const document of current.documents || (current.checks ? [current] : [])) {
        await rendered(document);
        report.rangeChecks += document.checks.length;
        report.characterChecks += document.checks.reduce((sum, check) => sum + check.text.replace(/\s/g, '').length, 0);
      }
      if (current.restore) {
        await until(current.name, async () => {
          const lines = canonical(await snapshot(current.major));
          const baseline = canonical(baselines.get(current.restore));
          assert.deepEqual(current.onlyLine === undefined ? lines : lines[current.onlyLine], current.onlyLine === undefined ? baseline : baseline[current.onlyLine]);
          return true;
        });
        report.characterChecks += current.onlyLine === undefined ? canonical(baselines.get(current.restore)).flat().length
          : canonical(baselines.get(current.restore))[current.onlyLine].length;
      }
      if (current.compare) {
        const actual = await snapshot(current.major), baseline = baselines.get(current.compare);
        for (const range of current.ranges) {
          assert.deepEqual(actual[range.line].characters.slice(range.start, range.start + range.length), baseline[range.line].characters.slice(range.start, range.start + range.length));
          report.characterChecks += range.length;
        }
      }
      if (current.screenshot && process.env.TYPOSCRIPT_SCREENSHOT_DIR) {
        await fs.mkdir(process.env.TYPOSCRIPT_SCREENSHOT_DIR, { recursive: true });
        if (current.screenshot !== 'project-navigation.png' && !current.editorScreenshot) {
          const ui = await picker();
          await ui(`document.activeElement?.blur(); window.scrollTo(0, 0); document.documentElement.scrollTop = 0; document.body.scrollTop = 0;`);
        } else if (current.screenshot === 'project-navigation.png') {
          const sash = await evaluate(`(() => {
            const candidates = [...document.querySelectorAll('.part.sidebar .monaco-sash.horizontal')]
              .map(node => node.getBoundingClientRect()).filter(r => r.width > 100 && r.height > 0 && r.y > 250 && r.y < 1000)
              .sort((a, b) => a.y - b.y);
            const r = candidates[0]; return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
          })()`);
          if (sash) {
            await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...sash });
            await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...sash, button: 'left', clickCount: 1 });
            await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: sash.x, y: 420, button: 'left', buttons: 1 });
            await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: sash.x, y: 420, button: 'left', clickCount: 1 });
          }
        }
        await pause(250);
        const capture = await call('Page.captureScreenshot', { format: 'png' });
        await fs.writeFile(path.join(process.env.TYPOSCRIPT_SCREENSHOT_DIR, current.screenshot), Buffer.from(capture.data, 'base64'));
      }
      if (current.name !== 'complete') report.stages.push({ name: current.name, characterChecks: report.characterChecks - before });
      else { report.editorVersion = current.editorVersion; report.extensionVersion = current.extensionVersion; }
      lastId = current.id;
      await fs.writeFile(`${ackFile}.tmp`, JSON.stringify({ id: current.id }));
      await fs.rename(`${ackFile}.tmp`, ackFile);
      if (current.name === 'complete') break;
    }
    report.passed = true;
  } catch (error) {
    report.passed = false;
    report.error = error.stack;
    if (current) report.failedStage = current.name;
    if (call) {
      try { const capture = await call('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(`${reportFile}.failure.png`, Buffer.from(capture.data, 'base64')); } catch {}
    }
    if (current) await fs.writeFile(ackFile, JSON.stringify({ id: current.id, error: error.message })).catch(() => {});
    throw error;
  } finally {
    socket?.close();
    await fs.mkdir(path.dirname(reportFile), { recursive: true });
    await fs.writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(`PASS: ${report.stages.length} rendered UI scenarios, ${report.rangeChecks} ranges, ${report.characterChecks} character foreground checks, ${report.imageChecks} images. Report: ${reportFile}`);
}

module.exports = { runColorProbe };
