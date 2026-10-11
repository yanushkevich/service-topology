#!/usr/bin/env node
// In-browser benchmark for the 2D map (ADR-005). Drives headless Chrome over the DevTools protocol
// against a running production build:
//
//   npm run build && npx vite preview --port 4173 &
//   npm run bench:browser -- --url http://localhost:4173 [--chrome "/path/to/chrome"] [--runs 15]
//
// Prints machine/browser details and a JSON + table summary. Numbers are wall-clock in the page
// (performance.now), so they include React rendering and, where stated, the ELK worker round trip.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, cpus, totalmem, release, platform } from 'node:os';
import { join } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith('--') ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), []),
);
const BASE = args.url ?? 'http://localhost:4173';
const RUNS = Number(args.runs ?? 15);
const CHROME =
  args.chrome ??
  process.env.CHROME ??
  (platform() === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');
const PORT = 9400 + Math.floor(Math.random() * 500);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stats = (samples) => {
  const s = [...samples].sort((a, b) => a - b);
  const at = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return { median: +at(0.5).toFixed(1), p95: +at(0.95).toFixed(1), min: +s[0].toFixed(1), max: +s.at(-1).toFixed(1), n: s.length };
};

async function main() {
  const profile = mkdtempSync(join(tmpdir(), 'bench-chrome-'));
  const chrome = spawn(CHROME, ['--headless=new', '--hide-scrollbars', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'], {
    stdio: 'ignore',
  });
  try {
    let version;
    for (let i = 0; i < 80 && !version; i++) {
      try {
        version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
      } catch {
        await sleep(150);
      }
    }
    if (!version) throw new Error('Chrome did not start');
    const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    let id = 0;
    const pending = new Map();
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) {
        pending.get(m.id)(m);
        pending.delete(m.id);
      }
    };
    const send = (method, params = {}) =>
      new Promise((resolve) => {
        const i = ++id;
        pending.set(i, resolve);
        ws.send(JSON.stringify({ id: i, method, params }));
      });
    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
      return r.result?.result?.value;
    };
    const open = async (path) => {
      await send('Page.navigate', { url: BASE + path });
      await sleep(300);
    };

    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });

    // Helpers injected into the page.
    const helpers = `
      window.__waitFor = (pred, timeout = 30000) => new Promise((resolve, reject) => {
        const start = performance.now();
        const tick = () => { const v = pred(); if (v) return resolve(v); if (performance.now() - start > timeout) return reject(new Error('timeout')); requestAnimationFrame(tick); };
        tick();
      });
      window.__frames = (n = 2) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
      window.__scope = () => document.querySelector('[aria-live="polite"]')?.textContent ?? '';
    `;

    const results = {};

    // 1. Initial render of the 250-node / 750-edge fixture.
    const loads = [];
    const layouts = [];
    let counts;
    for (let i = 0; i < Math.min(RUNS, 5); i++) {
      await open('/map?dataset=scale-250');
      await evaluate(helpers);
      const r = await evaluate(`(async () => {
        await __waitFor(() => performance.getEntriesByName('topology-rendered').length > 0 && document.querySelectorAll('.react-flow__node-entity').length >= 250);
        await __frames(2);
        return {
          rendered: performance.now(),
          layout: performance.getEntriesByName('topology-layout').at(-1)?.duration ?? null,
          nodes: document.querySelectorAll('.react-flow__node-entity').length,
          edges: document.querySelectorAll('.react-flow__edge').length,
        };
      })()`);
      loads.push(r.rendered);
      if (r.layout !== null) layouts.push(r.layout);
      counts = { nodes: r.nodes, edges: r.edges };
    }
    results['250/750: navigation → map painted (ms)'] = stats(loads);
    results['250/750: ELK worker layout incl. transfer (ms)'] = stats(layouts);
    results['250/750: rendered elements'] = counts;

    // 2. Selection response: click node → inspector shows it (+2 frames). Interaction tests start
    // after the canvas settles (fit-to-view animation, first layout) so they measure steady state.
    await sleep(1500);
    const selection = await evaluate(`(async () => {
      const nodes = [...document.querySelectorAll('.react-flow__node-entity')].slice(0, ${RUNS});
      const samples = [];
      for (const node of nodes) {
        const name = node.getAttribute('aria-label').split(',')[0];
        const t0 = performance.now();
        node.click();
        await __waitFor(() => document.querySelector('aside[aria-label="Inspector"] h2')?.textContent === name);
        await __frames(2);
        samples.push(performance.now() - t0);
      }
      return samples;
    })()`);
    results['250/750: select node → inspector + highlight painted (ms)'] = stats(selection);

    // 3. Filter response: toggle a health chip; state/UI update vs. full relayout.
    const filter = await evaluate(`(async () => {
      [...document.querySelectorAll('button[aria-expanded]')].find((b) => b.textContent.startsWith('Filters'))?.click();
      await __waitFor(() => document.querySelector('[role="dialog"][aria-label="Map filters"]'));
      const chip = [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.includes('Degraded'));
      const ui = [], full = [];
      for (let i = 0; i < ${Math.min(RUNS, 8)}; i++) {
        const before = __scope();
        const layoutsBefore = performance.getEntriesByName('topology-layout').length;
        const t0 = performance.now();
        chip.click();
        await __waitFor(() => __scope() !== before);
        await __frames(1);
        ui.push(performance.now() - t0);
        await __waitFor(() => performance.getEntriesByName('topology-layout').length > layoutsBefore);
        await __frames(2);
        full.push(performance.now() - t0);
      }
      return { ui, full };
    })()`);
    results['250/750: filter toggle → counts/state updated, excl. layout (ms)'] = stats(filter.ui);
    results['250/750: filter toggle → relaid out and painted (ms)'] = stats(filter.full);

    // 4. Pan/zoom smoothness: frame intervals while wheel-zooming.
    await open('/map?dataset=scale-250');
    await evaluate(helpers);
    const frames = await evaluate(`(async () => {
      await __waitFor(() => document.querySelectorAll('.react-flow__node-entity').length >= 250);
      await new Promise((r) => setTimeout(r, 1500));
      const pane = document.querySelector('.react-flow__pane');
      const rect = pane.getBoundingClientRect();
      const deltas = [];
      let last = performance.now(), running = true;
      const loop = (t) => { deltas.push(t - last); last = t; if (running) requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
      for (let i = 0; i < 60; i++) {
        pane.dispatchEvent(new WheelEvent('wheel', { deltaY: i < 30 ? -40 : 40, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2, bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 16));
      }
      running = false;
      return deltas.slice(2);
    })()`);
    const frameStats = stats(frames);
    results['250/750: wheel zoom frame interval (ms)'] = { ...frameStats, avgFps: +(1000 / (frames.reduce((a, b) => a + b, 0) / frames.length)).toFixed(1) };

    // 5. 1,000-entity inventory: guard, grouping, registry search.
    const inventory = [];
    for (let i = 0; i < Math.min(RUNS, 3); i++) {
      await open('/map?dataset=inventory-1000');
      await evaluate(helpers);
      inventory.push(
        await evaluate(`(async () => {
          await __waitFor(() => [...document.querySelectorAll('h2')].some((h) => /entities match/.test(h.textContent)));
          const guard = performance.now();
          const t0 = performance.now();
          [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Group by provider')).click();
          await __waitFor(() => document.querySelectorAll('.react-flow__node-entity').length > 0 && /collapsed/.test(document.querySelector('.react-flow__node-entity')?.getAttribute('aria-label') ?? ''));
          await __frames(2);
          return { guard, grouped: performance.now() - t0, nodes: document.querySelectorAll('.react-flow__node-entity').length };
        })()`),
      );
    }
    results['1,000 inventory: navigation → "too many" guard shown (ms)'] = stats(inventory.map((r) => r.guard));
    results['1,000 inventory: group by provider → painted (ms)'] = stats(inventory.map((r) => r.grouped));

    await open('/registry?dataset=inventory-1000');
    await evaluate(helpers);
    const registry = await evaluate(`(async () => {
      await __waitFor(() => document.querySelectorAll('tbody tr').length > 0);
      const rows = document.querySelectorAll('tbody tr').length;
      const loaded = performance.now();
      const input = document.querySelector('input[type="search"][placeholder^="Search name"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      const samples = [];
      for (const q of ['pay', 'ledger', 'catalog-api', 'zz', '']) {
        const before = document.querySelectorAll('tbody tr').length + ':' + __scope();
        const t0 = performance.now();
        setter.call(input, q);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await __waitFor(() => document.querySelectorAll('tbody tr').length + ':' + __scope() !== before);
        await __frames(1);
        samples.push(performance.now() - t0);
      }
      return { rows, loaded, samples };
    })()`);
    results['1,000 inventory: registry rows in production'] = { rows: registry.rows };
    results['1,000 inventory: registry first paint (ms)'] = { value: +registry.loaded.toFixed(1) };
    results['1,000 inventory: registry search keystroke → rows painted (ms)'] = stats(registry.samples);

    const environment = {
      date: new Date().toISOString(),
      cpu: cpus()[0]?.model,
      cores: cpus().length,
      memoryGB: Math.round(totalmem() / 2 ** 30),
      os: `${platform()} ${release()}`,
      browser: version.Browser,
      mode: 'headless Chrome, 1440×900, DPR 1, production build (vite preview)',
    };
    console.log(JSON.stringify({ environment, results }, null, 2));
    console.table(
      Object.entries(results).map(([name, r]) => ({ case: name, median: r.median ?? r.value ?? r.rows ?? `${r.nodes}/${r.edges}`, p95: r.p95 ?? '', n: r.n ?? '', fps: r.avgFps ?? '' })),
    );
    ws.close();
  } finally {
    chrome.kill();
    await sleep(300);
    rmSync(profile, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
