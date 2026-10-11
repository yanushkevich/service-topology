#!/usr/bin/env node
// 3D galaxy benchmark (Milestone 4, ADR-005). Drives headless Chrome over the DevTools protocol
// against a running production build:
//
//   npm run build && npx vite preview --port 4173 &
//   npm run bench:3d -- --url http://localhost:4173 [--chrome "/path/to/chrome"] [--gpu]
//
// Without --gpu, Chrome renders WebGL with SwiftShader (CPU). That gives a pessimistic lower bound,
// not representative of a GPU-equipped desktop. Prints environment + JSON + table.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, cpus, totalmem, release, platform } from 'node:os';
import { join } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith('--') ? [...pairs, [arg.slice(2), all[i + 1]?.startsWith('--') ? true : (all[i + 1] ?? true)]] : pairs), []),
);
const BASE = typeof args.url === 'string' ? args.url : 'http://localhost:4173';
const GPU = args.gpu === true || args.gpu === 'true';
const CHROME =
  (typeof args.chrome === 'string' && args.chrome) ||
  process.env.CHROME ||
  (platform() === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');
const PORT = 9500 + Math.floor(Math.random() * 400);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stats = (samples) => {
  const s = [...samples].sort((a, b) => a - b);
  const at = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return { median: +at(0.5).toFixed(1), p95: +at(0.95).toFixed(1), n: s.length };
};

async function main() {
  const profile = mkdtempSync(join(tmpdir(), 'bench3d-chrome-'));
  const flags = GPU ? [] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  const chrome = spawn(CHROME, ['--headless=new', '--hide-scrollbars', ...flags, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
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
    const results = {};
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) {
        pending.get(m.id)(m);
        pending.delete(m.id);
      }
    };
    const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
    /** Run a step; a failure is recorded as "not measured" instead of aborting the benchmark. */
    const attempt = async (name, fn) => {
      try {
        await fn();
      } catch (error) {
        results[name] = { value: `not measured (${String(error?.message ?? error).slice(0, 60)})` };
      }
    };
    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
      return r.result?.result?.value;
    };
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    const helpers = `
      window.__waitFor = (pred, timeout = 60000) => new Promise((resolve, reject) => { const t0 = performance.now(); const tick = () => { const v = pred(); if (v) return resolve(v); if (performance.now() - t0 > timeout) return reject(new Error('timeout')); requestAnimationFrame(tick); }; tick(); });
      window.__frames = (n = 2) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
      window.__frameIntervals = (ms) => new Promise((resolve) => { const out = []; let last = performance.now(); const end = last + ms; const f = (t) => { out.push(t - last); last = t; if (t < end) requestAnimationFrame(f); else resolve(out.slice(2)); }; requestAnimationFrame(f); });
      window.__btn = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(text));
    `;
    const open = async (path) => {
      await send('Page.navigate', { url: BASE + path });
      await sleep(400);
      await evaluate(helpers);
    };
    const step = (name) => console.error(`[bench-3d] ${name}`);

    step('load 250/750 overview');
    // 1. Load the 250/750 overview directly in 3D.
    const loads = [];
    let webgl;
    for (let i = 0; i < 3; i++) {
      await open('/map?dataset=scale-250&v=1&env=production&view=3d');
      const r = await evaluate(`(async () => {
        await __waitFor(() => document.querySelector('canvas') && __btn('Entities in this scope'));
        await __frames(3);
        const gl = document.querySelector('canvas').getContext('webgl2');
        return { t: performance.now(), count: __btn('Entities in this scope').textContent, renderer: gl ? (gl.getExtension('WEBGL_debug_renderer_info') ? gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL) : 'webgl2') : 'unknown' };
      })()`);
      loads.push(r.t);
      webgl = r.renderer;
      results['250/750: entities in scope'] = { value: r.count };
    }
    results['250/750: navigation → 3D scene drawn (ms)'] = stats(loads);

    step('idle frames');
    // 2. Frame intervals: idle with simulated traffic particles (continuous rendering).
    await sleep(1500);
    const idle = await evaluate(`__frameIntervals(3000)`);
    results['250/750: frame interval, idle with traffic particles (ms)'] = { ...stats(idle), fps: +(1000 / (idle.reduce((a, b) => a + b, 0) / idle.length)).toFixed(1) };

    step('orbit frames');
    // 3. Frame intervals while orbiting (drag on the canvas).
    const orbit = await evaluate(`(async () => {
      const canvas = document.querySelector('canvas');
      const r = canvas.getBoundingClientRect();
      const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
      const opts = (x, y) => ({ clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, bubbles: true, isPrimary: true });
      canvas.dispatchEvent(new PointerEvent('pointerdown', opts(cx, cy)));
      const measure = __frameIntervals(2000);
      for (let i = 0; i < 110; i++) { canvas.ownerDocument.dispatchEvent(new PointerEvent('pointermove', opts(cx + i * 4, cy + Math.sin(i / 10) * 30))); await new Promise((res) => setTimeout(res, 16)); }
      canvas.ownerDocument.dispatchEvent(new PointerEvent('pointerup', opts(cx + 440, cy)));
      return measure;
    })()`);
    results['250/750: frame interval while orbiting (ms)'] = { ...stats(orbit), fps: +(1000 / (orbit.reduce((a, b) => a + b, 0) / orbit.length)).toFixed(1) };

    step('selection');
    // 4. Selection response via the accessible entity list → inspector updated (+2 frames).
    await attempt('250/750: select entity → inspector + highlight drawn (ms)', async () => {
    const select = await evaluate(`(async () => {
      __btn('Entities in this scope').click();
      await __frames(2);
      const buttons = [...document.querySelectorAll('[aria-label="Inside"] li > button:first-child')].slice(0, 12);
      const out = [];
      for (const b of buttons) {
        const name = b.querySelector('span:nth-child(2)').textContent;
        const t0 = performance.now();
        b.click();
        await __waitFor(() => document.querySelector('aside[aria-label="Inspector"] h2')?.textContent === name);
        await __frames(2);
        out.push(performance.now() - t0);
      }
      return out;
    })()`);
    results['250/750: select entity → inspector + highlight drawn (ms)'] = stats(select);
    });

    step('explore inside');
    // 5. Explore inside a constellation → breadcrumb updated (+2 frames), includes the dive animation.
    await attempt('250/750: Explore inside → new scope shown, incl. dive animation (ms)', async () => {
    const enter = await evaluate(`(async () => {
      const button = document.querySelector('[aria-label^="Explore inside"]');
      const name = button.getAttribute('aria-label').replace('Explore inside ', '');
      const t0 = performance.now();
      button.click();
      await __waitFor(() => [...document.querySelectorAll('nav[aria-label="Exploration path"] button')].some((b) => b.getAttribute('aria-current') === 'location' && b.textContent.startsWith(name)));
      await __frames(2);
      return performance.now() - t0;
    })()`);
    results['250/750: Explore inside → new scope shown, incl. dive animation (ms)'] = { value: +enter.toFixed(1) };
    });

    step('1,000 inventory');
    // 6. 1,000-entity inventory: aggregated overview.
    await open('/map?dataset=inventory-1000&v=1&env=production&view=3d');
    const inventory = await evaluate(`(async () => {
      await __waitFor(() => document.querySelector('canvas') && __btn('Entities in this scope'));
      await __frames(3);
      return { t: performance.now(), count: __btn('Entities in this scope').textContent, note: document.querySelector('nav[aria-label="Exploration path"]')?.parentElement?.querySelector('p')?.textContent ?? '' };
    })()`);
    results['1,000 inventory: navigation → aggregated 3D overview drawn (ms)'] = { value: +inventory.t.toFixed(1) };
    results['1,000 inventory: overview'] = { value: `${inventory.count} — ${inventory.note}` };

    const environment = {
      date: new Date().toISOString(),
      cpu: cpus()[0]?.model,
      cores: cpus().length,
      memoryGB: Math.round(totalmem() / 2 ** 30),
      os: `${platform()} ${release()}`,
      browser: version.Browser,
      webglRenderer: webgl,
      mode: `headless Chrome, 1440×900, DPR 1 (scene DPR capped at 1.75), production build; ${GPU ? 'GPU' : 'SwiftShader software WebGL (pessimistic)'}`,
    };
    console.log(JSON.stringify({ environment, results }, null, 2));
    console.table(Object.entries(results).map(([name, r]) => ({ case: name, median: r.median ?? r.value, p95: r.p95 ?? '', fps: r.fps ?? '' })));
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
