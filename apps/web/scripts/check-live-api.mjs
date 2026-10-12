#!/usr/bin/env node
// Live end-to-end check: the built frontend against the running Go API (docs/GETTING_STARTED.md).
// Opens pages with ?source=api in headless Chrome and verifies that they render backend data, label
// it honestly, and that every /api/v1 request the browser makes succeeds.
//
//   (backend) HTTP_ADDR=127.0.0.1:18090 make run
//   (apps/web) npm run build && VITE_API_PROXY_TARGET=http://127.0.0.1:18090 npx vite preview --port 4174 &
//   (apps/web) node scripts/check-live-api.mjs --url http://localhost:4174
//
// With --write it also creates, edits, and deletes an environment through the UI (ADR-020) and
// checks each step through the API, plus the blocked delete of a referenced resource. That changes
// data: point the API at a disposable database (MONGODB_DATABASE=topology_live_… and `make seed`).
//
// Exits non-zero on any failed check.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((p, a, i, all) => (a.startsWith('--') ? [...p, [a.slice(2), all[i + 1]]] : p), []));
const BASE = (args.url ?? 'http://localhost:4174').replace(/\/$/, '');
const CHROME = args.chrome ?? process.env.CHROME ?? (platform() === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');
const PORT = 9300 + Math.floor(Math.random() * 300);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Minimal Chrome DevTools Protocol session on one page. */
async function openBrowser() {
  const profile = mkdtempSync(join(tmpdir(), 'live-api-chrome-'));
  const chrome = spawn(CHROME, ['--headless=new', '--hide-scrollbars', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
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
  const listeners = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(m.error.message));
      else resolve(m.result);
    } else if (m.method) {
      for (const fn of listeners) fn(m);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, { resolve, reject });
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const close = async () => {
    ws.close();
    const exited = new Promise((r) => chrome.once('exit', r));
    chrome.kill();
    await exited;
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };
  return { send, evaluate, on: (fn) => listeners.push(fn), close };
}

async function main() {
  const browser = await openBrowser();
  const { send, evaluate } = browser;
  const api = []; // { url, status }
  const requests = new Map();
  browser.on((m) => {
    if (m.method === 'Network.requestWillBeSent' && m.params.request.url.includes('/api/v1/')) requests.set(m.params.requestId, m.params.request.url);
    if (m.method === 'Network.responseReceived' && requests.has(m.params.requestId)) api.push({ url: requests.get(m.params.requestId), status: m.params.response.status });
  });
  await send('Network.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  let failures = 0;
  const check = (name, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
  };
  const waitFor = async (expression, timeoutMs = 20000) => {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (await evaluate(`Boolean(${expression})`)) return true;
      await sleep(200);
    }
    return false;
  };
  const visit = async (path, ready) => {
    await send('Page.navigate', { url: BASE + path });
    return waitFor(ready);
  };
  // textContent, not innerText: tags are styled uppercase, and innerText applies text-transform.
  const text = () => evaluate('document.body.textContent');

  // Source of truth for comparisons: the API itself, through the same proxy the app uses.
  const topology = await (await fetch(`${BASE}/api/v1/topology?environmentId=production`)).json();
  const meta = await (await fetch(`${BASE}/api/v1/meta`)).json();
  check('API reachable through the frontend proxy', Array.isArray(topology.serviceInstances), `${topology.serviceInstances?.length} production instances, source ${meta.topology?.sourceType}`);

  check('map renders backend data', await visit('/map?v=1&env=production&source=api', `document.querySelectorAll('.react-flow__node-entity').length > 0`));
  const nodes = await evaluate(`document.querySelectorAll('.react-flow__node-entity').length`);
  check('map shows nodes', nodes > 0, `${nodes} nodes`);

  check('registry renders backend rows', await visit('/registry?v=1&env=production&source=api', `document.querySelectorAll('tbody tr').length > 0`));
  const rows = await evaluate(`document.querySelectorAll('tbody tr').length`);
  check('registry row count is plausible', rows > 0, `${rows} rows`);
  const registryText = await text();
  check('data source labelled as the backend API', registryText.includes('Backend API'), registryText.match(/Backend API( · [a-z ]+)*/)?.[0] ?? 'label not found');
  check('mock inventory not presented as live', !/\blive\b/i.test(registryText));

  const firstInstance = topology.serviceInstances?.[0]?.id;
  check(
    'inspector loads an entity from the API',
    await visit(`/registry?v=1&env=production&source=api&sel=service-instance:${encodeURIComponent(firstInstance)}`, `document.body.innerText.includes(${JSON.stringify(firstInstance)})`),
    firstInstance,
  );

  check('events catalog renders backend event types', await visit('/events?v=1&env=production&source=api', `document.querySelector('[aria-label="Event types"]')?.querySelectorAll('a, button, li').length > 0`));

  check('source=api survives navigation', (await evaluate('location.search')).includes('source=api'));

  if ('write' in args) {
    const stamp = Date.now();
    const name = `Live check ${stamp}`;
    const id = `live-check-${stamp}`;
    const entity = async () => (await fetch(`${BASE}/api/v1/entities/environment/${id}`)).status === 200 ? (await fetch(`${BASE}/api/v1/entities/environment/${id}`)).json() : null;
    const click = (selector, name) =>
      evaluate(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((b) => ((b.getAttribute('aria-label') || b.textContent) ?? '').trim().startsWith(${JSON.stringify(name)})); if (!el) return false; el.click(); return true; })()`);
    const typeInto = async (selector, text, clear = false) => {
      await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.focus(); ${clear ? 'el.select();' : ''} })()`);
      await send('Input.insertText', { text });
    };
    const dialogOpen = (title) => `[...document.querySelectorAll('[role="dialog"]')].some((d) => d.textContent.includes(${JSON.stringify(title)}))`;

    await visit('/registry?v=1&env=production&source=api', `document.querySelectorAll('tbody tr').length > 0`);
    check('New menu opens with entity kinds', (await click('button', 'New')) && (await waitFor(`document.querySelector('[role="menu"]')`)));
    check('environment form opens', (await click('[role="menuitem"]', 'Environment')) && (await waitFor(dialogOpen('New environment'))));
    await typeInto('[role="dialog"] input[name="name"]', name);
    await typeInto('[role="dialog"] input[name="id"]', id, true);
    await click('[role="dialog"] button', 'Create');
    check('create closes the form', await waitFor(`!document.querySelector('[role="dialog"]')`));
    const created = await entity();
    check('created environment is stored in the backend', created?.name === name, JSON.stringify(created));
    check('inspector shows the new environment', await waitFor(`document.querySelector('[aria-label="Inspector"]')?.textContent.includes(${JSON.stringify(name)})`));

    check('edit form opens from the inspector', (await click('[aria-label="Inspector"] button', `Edit ${name}`)) && (await waitFor(dialogOpen('Edit environment'))));
    await typeInto('[role="dialog"] input[name="name"]', `${name} (renamed)`, true);
    await click('[role="dialog"] button', 'Save changes');
    check('save closes the form', await waitFor(`!document.querySelector('[role="dialog"]')`));
    check('edit is stored in the backend', (await entity())?.name === `${name} (renamed)`);

    check('delete confirmation opens', (await click('[aria-label="Inspector"] button', `Delete ${name}`)) && (await waitFor(dialogOpen('Delete environment?'))));
    await click('[role="dialog"] button', 'Delete environment');
    check('delete closes the confirmation', await waitFor(`!document.querySelector('[role="dialog"]')`));
    check('environment is gone from the backend', (await entity()) === null);

    await visit('/registry?v=1&env=production&source=api&sel=resource:rds-orders-prod', `document.querySelector('[aria-label="Inspector"] button[aria-label^="Delete"]')`);
    await click('[aria-label="Inspector"] button', 'Delete');
    check('referenced resource cannot be deleted', await waitFor(`${dialogOpen('still referenced')} && [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === 'Delete resource')?.disabled`));
    const writes = api.filter((r) => /\/entities\//.test(r.url));
    check('UI wrote through the entity API', writes.length === 3 && writes.every((r) => r.status < 300), writes.map((r) => r.status).join(', '));
  }

  const failed = api.filter((r) => r.status >= 400);
  const paths = [...new Set(api.map((r) => new URL(r.url).pathname))].sort();
  check('browser called the API', api.length > 0, `${api.length} requests: ${paths.join(', ')}`);
  check('no failed API requests', failed.length === 0, failed.map((r) => `${r.status} ${r.url}`).join('; '));

  await browser.close();
  console.log(`\n${failures === 0 ? 'All live checks passed' : `${failures} live check(s) failed`} against ${BASE}`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
