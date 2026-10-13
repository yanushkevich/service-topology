import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderApp, resetUiStore } from '../../test/renderApp';

/** Panels are queried within their landmark: page-wide role queries walk the whole map. */
const panel = (label: string) => {
  const element = document.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (!element) throw new Error(`No panel "${label}"`);
  return element;
};
const ready = () => waitFor(() => panel('Flow card'));
const params = (router: ReturnType<typeof renderApp>) => new URLSearchParams(router.state.location.search);
const BOARD = '/flows/flow-checkout?v=1&env=production';

describe('business flows catalog (ADR-022)', () => {
  beforeEach(resetUiStore);

  it('lists the flows of the environment from the navigation, searchable by step, service, or event', async () => {
    const user = userEvent.setup();
    const router = renderApp('/settings');
    await waitFor(() => expect(document.querySelector('a[href^="/flows"]')).not.toBeNull());
    await user.click(document.querySelector<HTMLAnchorElement>('a[href^="/flows"]')!);
    expect(router.state.location.pathname).toBe('/flows');
    const list = await screen.findByRole('list', { name: 'Business flows' });
    expect(within(list).getAllByRole('listitem').map((li) => within(li).getByRole('link').textContent)).toEqual(['CHCheckout', 'RERefund']);
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent(/12 in 6 services/);
    await user.type(screen.getByRole('searchbox', { name: 'Search flows' }), 'RefundIssued');
    expect(within(screen.getByRole('list', { name: 'Business flows' })).getAllByRole('listitem')).toHaveLength(1);
    await user.clear(screen.getByRole('searchbox', { name: 'Search flows' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search flows' }), 'zzz');
    expect(screen.getByText(/No flow matches “zzz”/)).toBeInTheDocument();
  });
});

describe('flow board, typical mode', () => {
  beforeEach(resetUiStore);

  it('shows the flow as example data with stages, budget, outcomes, and flow-level findings', async () => {
    renderApp(BOARD);
    await ready();
    expect(screen.getByRole('heading', { level: 1, name: 'Checkout' })).toBeInTheDocument();
    expect(screen.getByText(/^Example data · last 24 hours$/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\blive\b/i);
    const stages = within(panel('Step strip')).getByRole('list', { name: 'Stages of Checkout' });
    expect(within(stages).getAllByRole('listitem').length).toBeGreaterThan(5);
    expect(panel('Step strip')).toHaveTextContent(/→ Reserve stock OrderPlaced/);
    // Policy names come from the pattern catalog (ADR-024).
    expect(panel('Step strip')).toHaveTextContent(/no dedupe \(Idempotent consumer, missing\) · missing/);
    expect(panel('Step strip')).toHaveTextContent(/relay every 200 ms \(Polling publisher, declared and observed\)/);
    const card = panel('Flow card');
    expect(card).toHaveTextContent(/The synchronous steps of the typical path may take up to 23 s against the 4 s response-time target \(p95\): 19 s over\./);
    expect(within(card).getByRole('region', { name: 'Outcomes' })).toHaveTextContent(/Completed \(success\)97.5%/);
    const findings = within(card).getByRole('region', { name: 'Findings' });
    // Retries multiplied across levels, read from the Payment Service transit board's card client.
    await waitFor(() => expect(findings).toHaveTextContent('Authorize payment: Order Service retries 3× and the card client retries 4× inside: up to 12 calls per checkout.'));
    expect(findings).toHaveTextContent('Capture payment is not undone when the flow ends Cancelled');
    // Messaging reliability (ADR-024): OrderPlaced is redelivered and Reserve stock does not deduplicate.
    expect(findings).toHaveTextContent('OrderPlaced (Place order → Reserve stock) can be delivered more than once, and Reserve stock has neither an inbox nor an idempotent consumer');
    expect(findings).not.toHaveTextContent('No idempotent consumer on Place order');
  });

  it('highlights a finding’s steps and selects a step with a drill-down to its service board', async () => {
    const user = userEvent.setup();
    const router = renderApp(BOARD);
    await ready();
    await user.click(within(panel('Flow card')).getByRole('button', { name: /Capture payment is not undone/ }));
    const focused = [...panel('Step strip').querySelectorAll('[data-focused]')];
    expect(focused).toHaveLength(1);
    expect(focused[0]).toHaveTextContent(/^Capture payment/);
    await user.click(within(panel('Step strip')).getByRole('button', { name: /^Authorize payment/ }));
    expect(params(router).get('step')).toBe('authorize-payment');
    const detail = within(panel('Flow card')).getByRole('region', { name: 'Step: Authorize payment' });
    expect(detail).toHaveTextContent(/Payment Service · decision · Authorize · deadline 3 s · undone by Void authorization/);
    await user.click(within(detail).getByRole('link', { name: 'Open the Payment Service transit board' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/services/payment-service/transit'));
    // The entry point names the line; the board rewrites it to the line's ID.
    await waitFor(() => expect(params(router).get('line')).toBe('A1'));
  });

  it('draws one flow as swimlanes, selects steps by click or keyboard, and never moves anything', async () => {
    const router = renderApp(BOARD);
    await ready();
    const map = panel('Map');
    expect([...map.querySelectorAll('[data-lane-caption]')].map((l) => l.textContent)).toEqual(['Order Service', 'Inventory Service', 'Payment Service', 'Notification Service', 'Ledger Service', 'Email Dispatcher', 'Outcomes']);
    // One flow per board: Refund's steps are not drawn.
    expect(map.querySelector('[data-step="request-refund"]')).toBeNull();
    const positions = () => [...map.querySelectorAll<HTMLElement>('.react-flow__node')].map((n) => `${n.dataset.id}@${n.style.transform}`);
    const paths = () => [...map.querySelectorAll('.react-flow__edge-path')].map((p) => p.getAttribute('d'));
    const before = { nodes: positions(), edges: paths() };
    expect(before.edges.length).toBeGreaterThan(10);
    fireEvent.click(map.querySelector('[data-step="post-to-ledger"]')!);
    await waitFor(() => expect(params(router).get('step')).toBe('post-to-ledger'));
    expect(map.querySelector('[data-step="post-to-ledger"]')).toHaveAttribute('data-selected');
    expect(positions()).toEqual(before.nodes);
    expect(paths()).toEqual(before.edges);
    // Keyboard: Enter on a focused step selects it.
    const ship = map.querySelector<HTMLElement>('.react-flow__node[data-id="ship-order"]')!;
    ship.focus();
    fireEvent.keyDown(ship, { key: 'Enter' });
    await waitFor(() => expect(params(router).get('step')).toBe('ship-order'));
    // Compensation runs on dashed undo tracks.
    expect(map.querySelector('[data-transition="void"]')).toHaveAttribute('data-undo');
    fireEvent.pointerEnter(map.querySelector('[data-stop^="flow-checkout:settled:"]')!);
    expect(within(map).getByRole('tooltip')).toHaveTextContent(/Transactional outbox · declared and observed.*on “Await settlement → Post to ledger”/);
  });

  it('focuses a finding’s steps on the map', async () => {
    const user = userEvent.setup();
    renderApp(BOARD);
    await ready();
    await user.click(within(panel('Flow card')).getByRole('button', { name: /Capture payment is not undone/ }));
    const map = panel('Map');
    expect(map.querySelector('[data-step="capture-payment"]')).toHaveAttribute('data-emphasis', 'focus');
    expect(map.querySelector('[data-step="place-order"]')).toHaveAttribute('data-emphasis', 'dim');
  });

  it('switches the window and reports an unknown flow', async () => {
    const user = userEvent.setup();
    const router = renderApp(BOARD);
    await ready();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Window' }), '7d');
    await waitFor(() => expect(params(router).get('window')).toBe('7d'));
    await waitFor(() => expect(panel('Flow card')).toHaveTextContent(/Transactions, last 7 days176k/));
  });

  it('explains an unknown flow ID', async () => {
    renderApp('/flows/nope');
    expect(await screen.findByText(/No business flow with ID “nope” exists/)).toBeInTheDocument();
  });
});

describe('business-transaction replay', () => {
  beforeEach(resetUiStore);
  const openReplay = async (extra = '') => {
    const router = renderApp(`${BOARD}&mode=replay${extra}`);
    await waitFor(() => within(panel('Step strip')).getByRole('list', { name: /^Steps of order / }));
    return router;
  };
  const current = () => within(panel('Step strip')).getAllByRole('button').find((b) => b.getAttribute('aria-current') === 'step');

  it('offers samples and replays the chosen transaction with a train on the map', async () => {
    const user = userEvent.setup();
    await openReplay();
    const samples = within(panel('Flow card')).getByRole('region', { name: 'Sample transactions' });
    for (const reason of ['slowest', 'failed', 'compensated', 'with retries', 'typical']) expect(samples).toHaveTextContent(reason);
    expect(panel('Map').querySelectorAll('[data-train]')).toHaveLength(1);
    await user.click(within(panel('Flow card')).getByRole('button', { name: 'Next' }));
    expect(current()).toHaveTextContent('Reserve stock');
    expect(panel('Map').querySelector('[data-train]')).toHaveAttribute('data-train', 'reserve-stock');
    // The transition taken so far is highlighted.
    expect(panel('Map').querySelector('[data-transition="placed"]')).toHaveAttribute('data-emphasis', 'traversed');
  });

  it('shows compressed waits, compensation on the undo track, the divergence, and trace drill-down', async () => {
    const router = await openReplay('&tx=order%204466');
    const strip = panel('Step strip');
    expect(strip).toHaveTextContent('10 min (compressed)');
    expect(strip).toHaveTextContent('undo');
    expect(within(panel('Flow card')).getByRole('region', { name: 'Compared with typical' })).toHaveTextContent(/Left the typical path to Cancel order after “No settlement webhook within 10 min”/);
    expect(strip.querySelector('[data-divergence]')).toHaveTextContent('diverges from typical');
    const link = within(strip).getAllByRole('link', { name: 'Open this step’s trace' })[0]!;
    fireEvent.click(link);
    await waitFor(() => expect(router.state.location.pathname).toBe('/services/payment-service/transit'));
    expect(params(router).get('mode')).toBe('trace');
    expect(params(router).get('trace')).toMatch(/^a/);
  });

  it('marks uncorrelated gaps and messages dropped without a dead-letter queue', async () => {
    await openReplay('&tx=order%204450');
    expect(panel('Step strip').querySelector('[data-correlated="false"]')).toHaveTextContent('not correlated');
    expect(panel('Flow card')).toHaveTextContent(/gap is shown, not bridged/);
  });

  it('opens a transaction by business key, steps with the keyboard, and returns to typical with T', async () => {
    const user = userEvent.setup();
    const router = await openReplay();
    await user.type(within(panel('Flow card')).getByRole('textbox', { name: 'Business key' }), 'order 4458');
    await user.click(within(panel('Flow card')).getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(params(router).get('tx')).toBe('order 4458'));
    await waitFor(() => expect(panel('Step strip')).toHaveTextContent('dropped: no dead-letter queue'));
    fireEvent.keyDown(panel('Map'), { key: 'ArrowRight' });
    expect(current()).toHaveTextContent('Reserve stock');
    fireEvent.keyDown(panel('Map'), { key: 'T' });
    await waitFor(() => expect(params(router).get('mode')).toBeNull());
    await user.type(within(panel('Flow card')).getByRole('button', { name: 'Replay a business transaction' }), '{Enter}');
  });

  it('reports an unknown business key', async () => {
    const user = userEvent.setup();
    await openReplay();
    await user.type(within(panel('Flow card')).getByRole('textbox', { name: 'Business key' }), 'order 1');
    await user.click(within(panel('Flow card')).getByRole('button', { name: 'Open' }));
    expect(await within(panel('Flow card')).findByRole('alert')).toHaveTextContent('No transaction “order 1” for Checkout.');
  });
});

describe('flow board: the 3D drill-down without WebGL (ADR-026)', () => {
  beforeEach(resetUiStore);

  it('falls back with a message and returns to the swimlane', async () => {
    const user = userEvent.setup();
    const router = renderApp('/flows/flow-checkout?v=1&env=production&scene=3d&step=capture-payment');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('3D needs WebGL');
    await user.click(within(alert).getByRole('button', { name: 'Show the swimlane' }));
    const search = new URLSearchParams(router.state.location.search);
    expect(search.get('scene')).toBeNull();
    expect(search.get('step')).toBe('capture-payment');
    expect(await screen.findByRole('button', { name: 'Swimlane' })).toHaveAttribute('aria-pressed', 'true');
  });
});

