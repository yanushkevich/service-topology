#!/usr/bin/env node
// Real-browser accessibility audit (Milestone 5). Runs against a production build:
//
//   npm run build && npx vite preview --port 4173 &
//   npm run audit:a11y -- --url http://localhost:4173
//
// For every page in both themes: axe-core (WCAG 2.x A/AA incl. color-contrast, which needs real
// layout), a keyboard pass that checks each focused element shows a visible focus indicator, and a
// reduced-motion check. Exits non-zero on violations.

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const AXE_SOURCE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const args = Object.fromEntries(process.argv.slice(2).reduce((p, a, i, all) => (a.startsWith('--') ? [...p, [a.slice(2), all[i + 1]]] : p), []));
const BASE = args.url ?? 'http://localhost:4173';
const CHROME = args.chrome ?? process.env.CHROME ?? (platform() === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');
const PORT = 9600 + Math.floor(Math.random() * 300);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGES = [
  { name: 'Service map (2D, selection)', path: '/map?v=1&env=production&sel=service-instance:payment-service.production', ready: '.react-flow__node-entity' },
  { name: 'Service map (grouped)', path: '/map?v=1&env=production&layout=infrastructure', ready: '.react-flow__node-entity' },
  { name: 'Service map (3D)', path: '/map?v=1&env=production&view=3d', ready: 'canvas' },
  { name: 'Registry (selection)', path: '/registry?v=1&env=production&sel=service-instance:order-service.production', ready: 'tbody tr' },
  { name: 'Simulation', path: '/simulation?v=1&env=production', ready: '[aria-label="Snapshots"]' },
  { name: 'Events catalog', path: '/events/event-order-placed?v=1&env=production', ready: '[aria-label="Event types"]' },
  { name: 'Service map (event highlight)', path: '/map?v=1&env=production&ev=event-order-placed', ready: '.react-flow__node-entity' },
  { name: 'History banner', path: '/registry?v=1&env=production&asof=fixture-0600', ready: 'tbody tr' },
  { name: 'Overview', path: '/overview?v=1&env=production', ready: 'section h2' },
  { name: 'Dependencies (selection)', path: '/dependencies?v=1&env=production&sel=service-instance:order-service.production', ready: 'section h2' },
  { name: 'Infrastructure', path: '/infrastructure?v=1&env=production', ready: '[role="treeitem"]' },
  { name: 'Settings', path: '/settings?v=1&env=production', ready: 'section h2' },
  { name: 'Transit board', path: '/services/payment-service/transit?v=1&env=production', ready: '[aria-label="Line card"]' },
  { name: 'Transit board (line selected)', path: '/services/payment-service/transit?v=1&env=production&line=A1', ready: '[aria-label="Line card"] h2' },
  { name: 'Transit board (trace replay)', path: '/services/payment-service/transit?v=1&env=production&line=A5&mode=trace', ready: '[aria-label^="Steps of trace"]' },
  { name: 'Transit board (business flow selected)', path: '/services/payment-service/transit?v=1&env=production&flow=flow-checkout&line=A2', ready: '[aria-label="Line card"] h2' },
  { name: 'Transit board (no board data, flows listed)', path: '/services/order-service/transit?v=1&env=production', ready: '[aria-label="Business flows on this service"] li' },
  { name: 'Transit board (Capture: data and dependencies)', path: '/services/payment-service/transit?v=1&env=production&line=A2', ready: '[aria-label="Line card"] [aria-label="Data"], [aria-label="Line card"] section' },
  { name: 'Transit board (process view)', path: '/services/payment-service/transit?v=1&env=production&line=W1&strip=process', ready: '[aria-label="Process of line W1"]' },
  { name: 'Flow board (process view)', path: '/flows/flow-checkout?v=1&env=production&strip=process', ready: '[aria-label="Process of Checkout"]' },
  { name: 'Business flows catalog', path: '/flows?v=1&env=production', ready: '[aria-label="Business flows"] li' },
  { name: 'Flow board (swimlane)', path: '/flows/flow-checkout?v=1&env=production', ready: '.react-flow__node-step' },
  { name: 'Flow board (step selected)', path: '/flows/flow-checkout?v=1&env=production&step=capture-payment', ready: '[aria-label="Flow card"] h2' },
  { name: 'Flow board (transaction replay)', path: '/flows/flow-checkout?v=1&env=production&mode=replay&tx=order%204466', ready: '[aria-label^="Steps of order"]' },
];

async function main() {
  const profile = mkdtempSync(join(tmpdir(), 'a11y-chrome-'));
  const chrome = spawn(CHROME, ['--headless=new', '--hide-scrollbars', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  const report = [];
  let failed = false;
  try {
    for (let i = 0; i < 80; i++) {
      try {
        await fetch(`http://127.0.0.1:${PORT}/json/version`);
        break;
      } catch {
        await sleep(150);
      }
    }
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
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? JSON.stringify(r.result.exceptionDetails));
      return r.result?.result?.value;
    };
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

    for (const theme of ['dark', 'light']) {
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'no-preference' }] });
      for (const page of PAGES) {
        await send('Page.navigate', { url: BASE + page.path });
        await sleep(400);
        await evaluate(`new Promise((resolve, reject) => { const t0 = performance.now(); const tick = () => document.querySelector(${JSON.stringify(page.ready)}) ? setTimeout(resolve, 1200) : performance.now() - t0 > 30000 ? reject(new Error('page not ready')) : requestAnimationFrame(tick); tick(); })`);
        await evaluate(AXE_SOURCE);
        // target-size (2.5.8) is checked everywhere except zoomable canvas content, whose controls
        // scale with the user's zoom; the full-size Groups panel / entity list are the equivalents.
        const violations = await evaluate(`(async () => {
          const tags = { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa'] } };
          const map = (r) => r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, sample: v.nodes.slice(0, 3).map((n) => n.target.join(' ') + ' — ' + (n.any[0]?.message ?? n.failureSummary ?? '').slice(0, 140)) }));
          const all = await axe.run(document, { ...tags, rules: { 'target-size': { enabled: false } } });
          const sizes = await axe.run({ include: [document], exclude: [['.react-flow__viewport']] }, { runOnly: { type: 'rule', values: ['target-size'] } });
          return [...map(all), ...map(sizes)];
        })()`);

        // Keyboard pass: press Tab (via the protocol) up to 40 times; each focused element must show
        // a visible indicator (outline or box-shadow).
        const focusMissing = [];
        let focusStops = 0;
        await evaluate(`document.activeElement?.blur()`);
        for (let i = 0; i < 40; i++) {
          await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
          await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
          const info = await evaluate(`(() => {
            const el = document.activeElement;
            if (!el || el === document.body) return null;
            // Visible if the element or its wrapper (:focus-within) draws an outline or ring.
            const shows = (node) => {
              if (!node || node === document.body) return false;
              const s = getComputedStyle(node);
              return (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== 'none');
            };
            const visible = shows(el) || shows(el.parentElement);
            const label = (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40);
            return { visible, label, tag: el.tagName.toLowerCase() };
          })()`);
          if (!info) break;
          focusStops++;
          if (!info.visible) focusMissing.push(`${info.tag} "${info.label}"`);
        }
        if (violations.length > 0 || focusMissing.length > 0) failed = true;
        report.push({ theme, page: page.name, violations, focusStops, focusWithoutIndicator: focusMissing });
      }
    }

    // Reduced motion: CSS transitions collapse to ~0.
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await send('Page.navigate', { url: `${BASE}/registry?v=1&env=production` });
    await sleep(1500);
    const reduced = await evaluate(`(() => { const el = document.querySelector('nav a'); return getComputedStyle(el).transitionDuration; })()`);
    const reducedOk = reduced.split(',').every((d) => parseFloat(d) <= 0.01);
    if (!reducedOk) failed = true;

    for (const r of report) {
      const status = r.violations.length === 0 && r.focusWithoutIndicator.length === 0 ? 'PASS' : 'FAIL';
      console.log(`${status}  [${r.theme}] ${r.page}: ${r.violations.length} axe violations, ${r.focusStops} focus stops, ${r.focusWithoutIndicator.length} without visible focus`);
      for (const v of r.violations) console.log(`      ${v.id} (${v.impact}, ${v.nodes} nodes): ${v.help}\n        ${v.sample.join('\n        ')}`);
      for (const f of r.focusWithoutIndicator) console.log(`      no focus indicator: ${f}`);
    }
    console.log(`${reducedOk ? 'PASS' : 'FAIL'}  reduced motion: nav transition-duration = ${reduced}`);
    ws.close();
  } finally {
    chrome.kill();
    await sleep(300);
    rmSync(profile, { recursive: true, force: true });
  }
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
