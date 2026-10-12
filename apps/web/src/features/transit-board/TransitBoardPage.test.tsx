import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMockTopologyRepository } from '../../data/repositories/mockTopologyRepository';
import { createInMemorySavedLayoutRepository } from '../../data/savedLayouts/SavedLayoutRepository';
import { createInMemorySnapshotRepository } from '../../data/snapshots/SnapshotRepository';
import { mockSnapshots } from '../../data/mock/snapshots';
import { useUiStore } from '../../state/uiStore';
import { renderApp, resetUiStore } from '../../test/renderApp';
import { paymentServiceBoard } from '../../transit/mock/paymentServiceBoard';
import { createExampleTransitRepository, type TransitRepository } from '../../transit/repository';
import type { TransitBoard } from '../../transit/types';

const BOARD = '/services/payment-service/transit';

function renderBoard(path = BOARD, transit?: TransitRepository) {
  return renderApp(path, createMockTopologyRepository(), createInMemorySavedLayoutRepository(), createInMemorySnapshotRepository(mockSnapshots()), transit);
}

const example = createExampleTransitRepository();
const repositoryOf = (board: () => Promise<TransitBoard | null>): TransitRepository => ({ ...example, getBoard: board });

/**
 * Panels are found by their landmark label and queried within: role queries over the whole page
 * would walk every SVG element of the map, which is slow in jsdom.
 */
const panel = (label: string) => {
  const element = document.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (!element) throw new Error(`No panel "${label}"`);
  return element;
};
const ready = () => waitFor(() => panel('Line card'));
const mapOf = () => panel('Map').querySelector('svg') as SVGSVGElement;
const lineRow = (code: string) => within(panel('Lines')).getByRole('button', { name: new RegExp(`^${code}: `) });
const card = () => panel('Line card');
const strip = () => panel('Stop strip');

describe('transit board (ADR-021, spec Phase 1)', () => {
  beforeEach(resetUiStore);

  it('opens from the inspector of a service instance and labels its data as example data', async () => {
    const user = userEvent.setup();
    useUiStore.setState({ selection: { kind: 'service-instance', id: 'payment-service.production' } });
    const router = renderApp('/registry');
    await user.click(await within(await screen.findByRole('complementary', { name: 'Inspector' })).findByRole('link', { name: 'Open transit board' }));
    expect(router.state.location.pathname).toBe(BOARD);
    expect(await screen.findByRole('heading', { level: 1, name: 'Transit board' })).toBeInTheDocument();
    await ready();
    expect(panel('Breadcrumb')).toHaveTextContent('Production / Payment Service /');
    expect(screen.getByText(/^Example data · last 24 hours$/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\blive\b/i);
    // No selection: a network summary and the data-source legend.
    expect(within(strip()).getByText('11 lines through this service')).toBeInTheDocument();
    expect(within(card()).getByRole('heading', { name: 'Where the map comes from' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Trace replay' })).toBeDisabled();
  });

  it('selects a line from the index: card, strip, budget, and URL follow', async () => {
    const user = userEvent.setup();
    const router = renderBoard();
    await ready();
    await user.click(lineRow('A2'));
    expect(new URLSearchParams(router.state.location.search).get('line')).toBe('A2');
    expect(within(card()).getByRole('heading', { name: 'Line A2: Capture' })).toBeInTheDocument();
    expect(within(card()).getByText('rpc Capture(CaptureRequest) returns (Payment)')).toBeInTheDocument();
    expect(within(card()).getByText(/Downstream timeouts add up to 13 s against a 3 s deadline: 10 s over\./)).toBeInTheDocument();
    const stops = within(strip()).getByRole('list', { name: 'Stops on line A2' });
    expect(within(stops).getAllByRole('listitem').map((li) => li.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('card client'), expect.stringContaining('retry ×3'), expect.stringContaining('Card Processor')]),
    );
    expect(within(strip()).getByRole('list', { name: 'Branch of line A2 from Capture' })).toHaveTextContent('payments-pg');
    expect(lineRow('A2')).toHaveAttribute('aria-current', 'true');
    // The selected line is drawn in the overlay; every other line is dimmed.
    expect(mapOf().querySelector('[data-selected-line="A2"]')).not.toBeNull();
    expect(mapOf().querySelector('[data-line="A1"]')).toHaveAttribute('data-state', 'dim');
  });

  it('changes only styles on selection and search: no map path is rebuilt', async () => {
    const user = userEvent.setup();
    renderBoard();
    await ready();
    const before = [...mapOf().querySelectorAll('[data-layer="static"] path')];
    const d = before.map((p) => p.getAttribute('d'));
    await user.click(lineRow('A3'));
    await user.type(within(panel('Lines')).getByRole('searchbox', { name: 'Find a line' }), 'ledger');
    await user.click(lineRow('W1'));
    const after = [...mapOf().querySelectorAll('[data-layer="static"] path')];
    expect(after).toHaveLength(before.length);
    after.forEach((p, i) => {
      expect(p).toBe(before[i]);
      expect(p.getAttribute('d')).toBe(d[i]);
    });
  });

  it('searches by transport and station name, dimming the rest of the map', async () => {
    const user = userEvent.setup();
    renderBoard();
    await ready();
    const search = within(panel('Lines')).getByRole('searchbox', { name: 'Find a line' });
    await user.type(search, 'ledger');
    const rows = within(panel('Lines'))
      .getAllByRole('button', { name: /^[A-Z]\d: / })
      .map((b) => b.textContent?.slice(0, 2));
    expect(rows).toEqual(['A3', 'W1', 'J2']); // grouped: gRPC, Webhooks, Scheduled
    expect(mapOf().querySelector('[data-line="W1"]')).toHaveAttribute('data-state', 'normal');
    expect(mapOf().querySelector('[data-line="A1"]')).toHaveAttribute('data-state', 'dim');
    await user.clear(search);
    await user.type(search, 'zzz');
    expect(within(panel('Lines')).getByRole('status')).toHaveTextContent('No line matches “zzz”');
  });

  it('asks which line when a shared station is clicked, and selects directly on a single-line station', async () => {
    const user = userEvent.setup();
    const router = renderBoard();
    await ready();
    fireEvent.click(mapOf().querySelector('[data-station="cli:card"]')!);
    const chooser = within(panel('Map')).getByRole('group', { name: 'Lines through card client' });
    expect(within(chooser).getAllByRole('button')).toHaveLength(7);
    expect(within(chooser).getAllByRole('button')[0]).toHaveFocus();
    await user.click(within(chooser).getByRole('button', { name: /ExpireAuthorizations/ }));
    expect(new URLSearchParams(router.state.location.search).get('line')).toBe('J1');
    fireEvent.click(mapOf().querySelector('[data-station="cli:fraud"]')!);
    expect(new URLSearchParams(router.state.location.search).get('line')).toBe('A1');
    // Clicking empty map clears the selection; so does Escape.
    fireEvent.click(mapOf().querySelector('[data-ground]')!);
    expect(new URLSearchParams(router.state.location.search).get('line')).toBeNull();
    await user.click(lineRow('A4'));
    await user.keyboard('{Escape}');
    expect(new URLSearchParams(router.state.location.search).get('line')).toBeNull();
  });

  it('moves through the index with the arrow keys', async () => {
    const user = userEvent.setup();
    renderBoard();
    await ready();
    const all = within(panel('Lines')).getByRole('button', { name: /^All lines/ });
    all.focus();
    await user.keyboard('{ArrowDown}');
    expect(lineRow('A1')).toHaveFocus();
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}');
    expect(lineRow('A2')).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(lineRow('A2')).toHaveAttribute('aria-current', 'true');
  });

  it('highlights the stops of a finding on the strip and the map', async () => {
    const user = userEvent.setup();
    renderBoard(`${BOARD}?v=1&env=production&line=A1`);
    await ready();
    const finding = within(card()).getByRole('button', { name: /fraud client has no breaker/ });
    await user.click(finding);
    expect(finding).toHaveAttribute('aria-pressed', 'true');
    const focused = strip().querySelectorAll('[data-focused]');
    expect([...focused].map((li) => li.textContent)).toEqual([expect.stringContaining('fraud client'), expect.stringContaining('Fraud Scoring')]);
    // Warnings come first; the missing breaker is shown as missing, in words.
    expect(within(card()).getAllByRole('button', { pressed: false })[0]).toHaveTextContent(/Warning/);
    expect(within(strip()).getByRole('list', { name: 'Stops on line A1' })).toHaveTextContent(/no breaker.*missing/);
  });

  it('keeps the line in a deep link through the URL state sync, and drops it when leaving', async () => {
    const user = userEvent.setup();
    const router = renderBoard(`${BOARD}?v=1&env=production&line=W1`);
    await ready();
    expect(within(card()).getByRole('heading', { name: 'Line W1: POST /webhooks/processor' })).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.search).toContain('line=W1'));
    await user.click(within(card()).getByRole('link', { name: 'Back to the service map' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/map'));
    expect(router.state.location.search).not.toContain('line=');
  });

  it('shows a line without traces as declared only', async () => {
    renderBoard(`${BOARD}?v=1&env=production&line=O1`);
    await ready();
    expect(within(card()).getByText(/No traces in the last 24 hours: this card lists declared steps only/)).toBeInTheDocument();
    expect(lineRow('O1')).toHaveTextContent('no traffic');
    expect(mapOf().querySelector('[data-selected-line="O1"]')).toHaveAttribute('stroke-dasharray', '10 7');
    expect(within(strip()).getByRole('heading', { name: /declared route \(no traces in this window\)/ })).toBeInTheDocument();
  });

  it('shows unknown policies, never missing ones, when a config source failed (partial data)', async () => {
    const board = paymentServiceBoard('production');
    board.sources = board.sources.map((s) => (s.id === 'resilience' ? { ...s, status: 'failed' } : s));
    board.policies = board.policies.map((p) => (p.clientId === 'cli:card' ? { ...p, state: 'unknown' } : p));
    renderBoard(`${BOARD}?v=1&env=production&line=A4`, repositoryOf(async () => board));
    await ready();
    expect(within(card()).getByRole('note')).toHaveTextContent('Data gaps. Could not load: Resilience config.');
    const stops = within(strip()).getByRole('list', { name: 'Stops on line A4' });
    expect(stops).toHaveTextContent(/unknown/);
    expect(stops).not.toHaveTextContent(/missing/);
    expect(within(card()).getByText(/1 client not counted: config not loaded/)).toBeInTheDocument();
  });

  it('shows a skeleton while loading', async () => {
    renderBoard(BOARD, repositoryOf(() => new Promise(() => {})));
    expect(await screen.findByRole('status', { name: 'Loading the transit board' })).toBeInTheDocument();
  });

  it('says when a service has no endpoints yet', async () => {
    renderBoard('/services/order-service/transit');
    expect(await screen.findByRole('heading', { name: 'No endpoints yet' })).toBeInTheDocument();
  });

  it('reports errors and retries', async () => {
    const user = userEvent.setup();
    let calls = 0;
    renderBoard(BOARD, repositoryOf(async () => (++calls === 1 ? Promise.reject(new Error('boom')) : paymentServiceBoard('production'))));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the transit board. boom');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await ready();
    expect(mapOf()).toHaveAccessibleName(/^Transit map of Payment Service: 11 lines/);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('explains an unknown service ID', async () => {
    renderBoard('/services/nope/transit');
    expect(await screen.findByText(/No service with ID “nope” exists in this data/)).toBeInTheDocument();
  });
});
