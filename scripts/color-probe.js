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
  const report = { stages: [], rangeChecks: 0, characterChecks: 0 };
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
    let webview;
    async function picker() {
      if (webview) return webview;
      const target = await until('color picker frame', async () => (await call('Target.getTargets')).targetInfos
        .find((entry) => entry.type === 'iframe' && entry.url.includes('stefan-sofka.typoscript-highlighting')));
      const { sessionId } = await call('Target.attachToTarget', { targetId: target.targetId, flatten: true });
      const tree = await until('loaded color picker', async () => {
        const result = await call('Page.getFrameTree', {}, sessionId);
        return result.frameTree.childFrames?.length ? result : false;
      });
      const { executionContextId } = await call('Page.createIsolatedWorld', {
        frameId: tree.frameTree.childFrames[0].frame.id, worldName: 'typoscript-color-test'
      }, sessionId);
      webview = (expression) => evaluate(expression, executionContextId, sessionId);
      await until('nine hex inputs', async () => (await webview(`document.querySelectorAll('.row input[type=text]').length`)) === 9);
      return webview;
    }
    async function enter(ui, category, value) {
      await ui(`(() => { const input = document.getElementById('hex-${category}'); input.focus(); input.value = ${JSON.stringify(value)};
        input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    }

    let lastId = 0;
    while (true) {
      current = await until('next rendered-color scenario', async () => {
        const value = JSON.parse(await fs.readFile(stateFile, 'utf8'));
        return value.id > lastId ? value : false;
      }, 40000);
      const before = report.characterChecks;
      if (current.action === 'picker') {
        const ui = await picker();
        assert.ok((await ui(`[...document.querySelectorAll('.row input[type=text]')].every(x => !x.value)`)), 'opening must retain System Default');
        await enter(ui, 'values', '#12GGGG');
        assert.equal(await ui(`document.getElementById('hex-values').getAttribute('aria-invalid')`), 'true');
        assert.equal(await ui(`document.querySelector('[data-category="values"] .reset').disabled`), false, 'an invalid draft must remain resettable');
        await pause(200);
        assert.deepEqual(canonical(await snapshot(14)), canonical(baselines.get(current.baselineKey)), 'invalid UI input must not recolor text');
        await ui(`document.querySelector('[data-category="values"] .reset').click()`);
        await until('invalid draft reset clears validation', async () => await ui(`document.getElementById('hex-values').value === ''
          && document.getElementById('hex-values').getAttribute('aria-invalid') === 'false'`));
        const palette = Object.fromEntries(current.checks.map((check) => [check.category, check.color]));
        for (const [category, color] of Object.entries(palette)) await enter(ui, category, color.toLowerCase().replace('#', ''));
        await rendered(current);
        await ui(`(() => { document.querySelector('[data-category="comments"] .swatch').click(); const hue = document.getElementById('hue');
          hue.value = '0'; hue.dispatchEvent(new Event('input', { bubbles: true })); hue.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        const rect = await ui(`(() => { const r = document.getElementById('spectrum').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
        const offset = await evaluate(`(() => { const r = [...document.querySelectorAll('iframe')].find(x => x.src.includes('stefan-sofka.typoscript-highlighting')).getBoundingClientRect(); return { x: r.x, y: r.y }; })()`);
        const x = offset.x + rect.x, y = offset.y + rect.y;
        await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + rect.width / 2, y: y + rect.height / 2 });
        await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: x + rect.width / 2, y: y + rect.height / 2, button: 'left', clickCount: 1 });
        await pause(100);
        await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + rect.width * .75, y: y + rect.height * .25, button: 'left', buttons: 1 });
        await pause(100);
        await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + rect.width * .75, y: y + rect.height * .25, button: 'left', clickCount: 1 });
        current.checks = current.checks.map((check) => check.category === 'comments' ? { ...check, color: '#BF3030' } : check);
      } else if (current.action === 'picker-reset') {
        const ui = await picker();
        await ui(`document.getElementById('spectrum').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))`);
        await until('spectrum keyboard adjustment', async () => {
          const value = await ui(`document.getElementById('hex-comments').value`);
          return value && value !== '#BF3030';
        });
        await ui(`[...document.querySelectorAll('.row .reset')].forEach(button => button.click())`);
        await until('all nine UI resets saved', async () => await ui(`document.getElementById('status').textContent !== 'Saving…'
          && [...document.querySelectorAll('.row input[type=text]')].every(input => input.value === '')`));
      } else if (current.action === 'picker-scopes') {
        const ui = await picker();
        for (const [scope, color] of [['user', '#112233'], ['workspace', '#332211'], [current.folderId, '#CC0066']]) {
          await ui(`(() => { const scope = document.getElementById('scope'); scope.value = ${JSON.stringify(scope)};
            scope.dispatchEvent(new Event('change', { bubbles: true })); })()`);
          await pause(150);
          // Explicit empty overrides in lower scopes must be removed first.
          // The initial reset saved an empty Folder override, so only the Folder
          // step changes this document; other scopes are inspected by the host.
          await enter(ui, 'comments', color);
          await until('scope write acknowledged', async () => {
            const value = await ui(`document.getElementById('hex-comments').value`);
            const status = await ui(`document.getElementById('status').textContent`);
            return value === color && status !== 'Saving…';
          });
        }
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
  console.log(`PASS: ${report.stages.length} rendered-color scenarios, ${report.rangeChecks} ranges, ${report.characterChecks} character foreground checks. Report: ${reportFile}`);
}

module.exports = { runColorProbe };
