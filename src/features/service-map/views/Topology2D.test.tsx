import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { generateTopology, INVENTORY_1000 } from '../../../data/mock/generateTopology';
import { createMockTopologyRepository } from '../../../data/repositories/mockTopologyRepository';
import { createInMemorySavedLayoutRepository } from '../../../data/savedLayouts/SavedLayoutRepository';
import { useUiStore } from '../../../state/uiStore';
import { renderApp, resetUiStore } from '../../../test/renderApp';

/**
 * Clicks inside the React Flow canvas use fireEvent.click: user-event also sends mousedown with
 * `view: null`, which d3-drag/d3-zoom cannot handle in jsdom. Selection and buttons use click.
 */
const canvasClick = (element: HTMLElement) => fireEvent.click(element);

/** React Flow node wrapper for an entity (aria-label starts with its display name). */
const findNode = (name: string) => screen.findByLabelText(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, `));
const nodeBox = (wrapper: HTMLElement) => wrapper.firstElementChild as HTMLElement;
/** 'selected' | 'highlighted' | 'dimmed' (dimmed = neither, while the canvas dims others) | 'none'. */
const emphasis = (wrapper: HTMLElement) => {
  const cls = nodeBox(wrapper).className;
  if (/selected/.test(cls)) return 'selected';
  if (/highlighted/.test(cls)) return 'highlighted';
  return wrapper.closest('.topology-dim-others') ? 'dimmed' : 'none';
};

describe('2D topology map', () => {
  beforeEach(resetUiStore);

  it('renders production entities from canonical data after layout', async () => {
    renderApp('/map');
    expect(await findNode('Order Service')).toBeInTheDocument();
    expect(await findNode('orders.events')).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Order Service, api.*staging/)).not.toBeInTheDocument();
    expect(screen.getByText(/Production · \d+ nodes · \d+ connections/)).toBeInTheDocument();
  });

  it('selects by canonical ID when a node is clicked and shows it in the inspector', async () => {
    renderApp('/map');
    canvasClick(await findNode('Payment Service'));
    expect(useUiStore.getState().selection).toEqual({ kind: 'service-instance', id: 'payment-service.production' });
    const inspector = screen.getByRole('complementary', { name: 'Inspector' });
    expect(within(inspector).getByRole('heading', { name: 'Payment Service' })).toBeInTheDocument();
  });

  it('reflects a registry selection on the map and highlights direct dependencies', async () => {
    useUiStore.setState({ selection: { kind: 'service-instance', id: 'order-service.production' } });
    renderApp('/map');
    await waitFor(async () => expect(emphasis(await findNode('Order Service'))).toBe('selected'));
    expect(emphasis(await findNode('Payment Service'))).toBe('highlighted');
    expect(emphasis(await findNode('Ledger Service'))).toBe('dimmed');
  });

  it('switches highlight to upstream (transitive dependencies)', async () => {
    const user = userEvent.setup();
    useUiStore.setState({ selection: { kind: 'service-instance', id: 'order-service.production' } });
    renderApp('/map');
    await findNode('Order Service');
    await user.click(screen.getByRole('button', { name: 'Upstream' }));
    expect(useUiStore.getState().highlightMode).toBe('upstream');
    // order → payment → payments.events → ledger
    await waitFor(async () => expect(emphasis(await findNode('Ledger Service'))).toBe('highlighted'));
    expect(emphasis(await findNode('API Gateway'))).toBe('dimmed');
  });

  it('applies shared filters from the map filter panel', async () => {
    const user = userEvent.setup();
    renderApp('/map');
    await findNode('Order Service');
    await user.click(screen.getByRole('button', { name: 'Filters' }));
    const panel = screen.getByRole('dialog', { name: 'Map filters' });
    await user.click(within(panel).getByRole('button', { name: 'Messaging' }));
    expect(useUiStore.getState().filters.groups).toEqual(['messaging']);
    await waitFor(() => expect(screen.queryByLabelText(/^Order Service, /)).not.toBeInTheDocument());
    expect(await findNode('orders.events')).toBeInTheDocument();
  });

  it('shows a no-matches state that clears filters', async () => {
    const user = userEvent.setup();
    useUiStore.setState({ filters: { query: 'zzz-nothing', providers: [], health: [], groups: [] } });
    renderApp('/map');
    expect(await screen.findByText('No matches')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Clear filters' }).at(-1)!);
    expect(await findNode('Order Service')).toBeInTheDocument();
  });

  it('groups by explicit containment and collapses/expands groups', async () => {
    useUiStore.setState({ layoutMode: 'infrastructure' });
    renderApp('/map');
    canvasClick(await screen.findByRole('button', { name: 'Collapse events-kafka' }));
    expect(await findNode('events-kafka')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByLabelText(/^orders\.events, /)).not.toBeInTheDocument());
    canvasClick(screen.getByRole('button', { name: 'Expand events-kafka' }));
    expect(await findNode('orders.events')).toBeInTheDocument();
  });

  it('explores a neighborhood from the inspector', async () => {
    const user = userEvent.setup();
    useUiStore.setState({ selection: { kind: 'service-instance', id: 'ledger-service.production' } });
    renderApp('/map');
    await findNode('Ledger Service');
    const inspector = screen.getByRole('complementary', { name: 'Inspector' });
    await user.click(within(inspector).getByRole('button', { name: 'Explore neighborhood' }));
    expect(useUiStore.getState().neighborhood).toEqual({ centerId: 'ledger-service.production', depth: 1 });
    await waitFor(() => expect(screen.getByText(/Production · 4 nodes/)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '2 hops' }));
    expect(useUiStore.getState().neighborhood?.depth).toBe(2);
  });

  it('tells the user when the selection is hidden, and can reveal it', async () => {
    const user = userEvent.setup();
    useUiStore.setState({
      selection: { kind: 'service-instance', id: 'order-service.staging' },
      filters: { query: '', providers: [], health: [], groups: [] },
    });
    renderApp('/map');
    await findNode('Order Service');
    expect(screen.getByText(/not on the map with the current environment/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show it' }));
    expect(useUiStore.getState().environmentId).toBe('staging');
  });

  it('keeps a 1,000-entity inventory navigable: asks to narrow, then groups by provider', async () => {
    const user = userEvent.setup();
    renderApp('/map', createMockTopologyRepository(generateTopology(INVENTORY_1000), 'Generated inventory'));
    expect(await screen.findByText(/entities match/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Group by provider (collapsed)' }));
    expect(useUiStore.getState().layoutMode).toBe('infrastructure');
    expect(await screen.findByLabelText(/^AWS, \d+ entities collapsed/)).toBeInTheDocument();
  });
});

describe('saved layouts on the map', () => {
  beforeEach(resetUiStore);

  it('saves positions keyed by canonical IDs with view options, and applies them back', async () => {
    const user = userEvent.setup();
    const repo = createInMemorySavedLayoutRepository();
    renderApp('/map', undefined, repo);
    await findNode('Order Service');
    await user.click(screen.getByRole('button', { name: 'Layouts' }));
    const menu = screen.getByRole('dialog', { name: 'Saved layouts' });
    await user.type(within(menu).getByLabelText('Layout name'), 'Incident review');
    await user.click(within(menu).getByRole('button', { name: 'Save' }));
    expect(await within(menu).findByText('Saved “Incident review”.')).toBeInTheDocument();

    const [saved] = await repo.list();
    expect(saved).toMatchObject({ schemaVersion: 1, name: 'Incident review', view: { environmentId: 'production', layoutMode: 'topology' } });
    expect(Object.keys(saved!.positions)).toContain('order-service.production');
    expect(Object.values(saved!.positions).every((p) => Object.keys(p).sort().join() === 'x,y')).toBe(true);

    // Edit the stored position and apply: the node moves there (saved positions override layout).
    await repo.save({ ...saved!, positions: { ...saved!.positions, 'order-service.production': { x: 1234, y: 567 } } });
    await user.click(screen.getByRole('button', { name: 'Layouts' }));
    await user.click(screen.getByRole('button', { name: 'Layouts' }));
    await user.click(await screen.findByRole('button', { name: 'Apply Incident review' }));
    await waitFor(async () => expect((await findNode('Order Service')).style.transform).toContain('translate(1234px,567px)'));
    expect(screen.getByRole('button', { name: 'Reset positions' })).toBeInTheDocument();
  });

  it('restores mode, environment, filters, and collapsed groups from a layout', async () => {
    const user = userEvent.setup();
    const repo = createInMemorySavedLayoutRepository([
      {
        schemaVersion: 1,
        id: 'l1',
        name: 'Staging grouped',
        createdAt: '2026-10-11T09:00:00.000Z',
        view: { environmentId: 'staging', layoutMode: 'infrastructure', filters: { query: '', providers: [], health: [], groups: ['service', 'messaging'] }, collapsedGroupIds: ['provider:azure'] },
        positions: {},
      },
    ]);
    renderApp('/map', undefined, repo);
    await findNode('Order Service');
    await user.click(screen.getByRole('button', { name: 'Layouts' }));
    await user.click(await screen.findByRole('button', { name: 'Apply Staging grouped' }));
    expect(useUiStore.getState()).toMatchObject({ environmentId: 'staging', layoutMode: 'infrastructure', filters: { groups: ['service', 'messaging'] } });
    expect(await screen.findByLabelText(/^Azure, 1 entity collapsed/)).toBeInTheDocument();
  });
});

describe('groups panel (full-size equivalent of in-canvas group headers)', () => {
  beforeEach(resetUiStore);

  it('collapses, expands, and selects groups at a fixed size, by keyboard or pointer', async () => {
    const user = userEvent.setup();
    useUiStore.setState({ layoutMode: 'infrastructure' });
    renderApp('/map');
    await findNode('orders.events');
    await user.click(screen.getByRole('button', { name: 'Groups' }));
    const panel = screen.getByRole('dialog', { name: 'Infrastructure groups' });

    await user.click(within(panel).getByRole('button', { name: 'Collapse events-kafka' }));
    expect(await findNode('events-kafka')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Expand events-kafka' })).toHaveAttribute('aria-expanded', 'false');

    await user.click(within(panel).getByRole('button', { name: 'Expand events-kafka' }));
    expect(await findNode('orders.events')).toBeInTheDocument();

    await user.click(within(panel).getByRole('button', { name: /^eks-commerce-prod/ }));
    expect(useUiStore.getState().selection).toEqual({ kind: 'resource', id: 'eks-commerce-prod' });
  });

  it('is only offered in grouped infrastructure mode', async () => {
    renderApp('/map');
    await findNode('Order Service');
    expect(screen.queryByRole('button', { name: 'Groups' })).not.toBeInTheDocument();
  });
});
