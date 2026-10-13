import { act, cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { createInMemorySavedLayoutRepository } from '../../data/savedLayouts/SavedLayoutRepository';
import { usePreferencesStore } from '../../state/preferencesStore';
import { useSimulationStore } from '../../state/simulationStore';
import { useUiStore } from '../../state/uiStore';
import { renderApp, resetUiStore } from '../../test/renderApp';

/** Integration tests for the Revision 5 section pages (PRODUCT_SPEC §K.1–K.4). */

describe('overview page', () => {
  beforeEach(resetUiStore);

  it('summarizes the environment and lists unhealthy entities with entry points', async () => {
    const user = userEvent.setup();
    const router = renderApp('/overview');
    const summary = await screen.findByRole('region', { name: 'Summary' });
    expect(within(summary).getByText('Service instances')).toBeInTheDocument();
    const attention = screen.getByRole('list', { name: 'Unhealthy entities' });
    expect(within(attention).getByText('inventory-db')).toBeInTheDocument();
    expect(within(attention).queryByText('Order Service')).not.toBeInTheDocument();

    await user.click(within(attention).getByRole('button', { name: 'Show on map: inventory-db' }));
    expect(router.state.location.pathname).toBe('/map');
    expect(useUiStore.getState().selection).toEqual({ kind: 'resource', id: 'rds-inventory-prod' });
  });

  it('leaves the inspector out until something is selected, on every section page', async () => {
    for (const path of ['/overview', '/dependencies', '/infrastructure', '/events', '/simulation']) {
      renderApp(path);
      await screen.findByRole('heading', { level: 1 });
      expect(screen.queryByRole('complementary', { name: 'Inspector' }), path).not.toBeInTheDocument();
      cleanup();
    }
    useUiStore.setState({ selection: { kind: 'service-instance', id: 'order-service.production' } });
    renderApp('/overview');
    expect(within(await screen.findByRole('complementary', { name: 'Inspector' })).getByRole('heading', { name: 'Order Service' })).toBeInTheDocument();
  });

  it('lists the business flows with their warnings, most first, linking to each board', async () => {
    const user = userEvent.setup();
    const router = renderApp('/overview?v=1&env=production');
    const flows = await screen.findByRole('list', { name: 'Business flows in this environment' });
    const items = within(flows).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([expect.stringMatching(/Checkout.*12 steps.*9 warnings/), expect.stringMatching(/Refund.*3 steps.*3 warnings/)]);
    await user.click(within(flows).getByRole('link', { name: 'Checkout' }));
    expect(router.state.location.pathname).toBe('/flows/flow-checkout');
  });

  it('labels simulated failures as simulated', async () => {
    renderApp('/overview');
    await screen.findByRole('list', { name: 'Unhealthy entities' });
    act(() => useSimulationStore.getState().inject('payment-service.production', 'unavailable'));
    const attention = screen.getByRole('list', { name: 'Unhealthy entities' });
    expect(await within(attention).findByText(/simulated failure/)).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Recent simulated events' })).getAllByRole('listitem').length).toBeGreaterThan(0);
  });

  it('summarizes a snapshot while browsing history', async () => {
    renderApp('/overview?v=1&env=production&asof=fixture-0600');
    expect(await screen.findByText(/as of snapshot/)).toBeInTheDocument();
  });

  it('opens the registry filtered to unhealthy entities', async () => {
    const user = userEvent.setup();
    const router = renderApp('/overview');
    await user.click(await screen.findByRole('button', { name: 'Registry: unhealthy only' }));
    expect(router.state.location.pathname).toBe('/registry');
    expect(useUiStore.getState().filters.health).toEqual(['unavailable', 'degraded']);
  });
});

describe('dependencies page', () => {
  beforeEach(resetUiStore);

  it('asks for an entity, then shows upstream, downstream, and the impact preview', async () => {
    const user = userEvent.setup();
    renderApp('/dependencies');
    expect(await screen.findByText(/Pick a service instance or resource/)).toBeInTheDocument();

    await user.type(screen.getByRole('searchbox', { name: 'Entity' }), 'order serv');
    await user.click(within(screen.getByRole('list', { name: 'Matching entities' })).getByRole('button', { name: /Order Service/ }));
    expect(useUiStore.getState().selection).toEqual({ kind: 'service-instance', id: 'order-service.production' });

    const upstream = await screen.findByRole('region', { name: /^Upstream/ });
    expect(within(upstream).getByText('Payment Service')).toBeInTheDocument();
    expect(within(upstream).getByText('orders-db')).toBeInTheDocument();
    const downstream = screen.getByRole('region', { name: /^Downstream/ });
    expect(within(downstream).getByText('API Gateway')).toBeInTheDocument();
    const impact = screen.getByRole('region', { name: 'If Order Service became unavailable' });
    expect(within(impact).getByText('API Gateway')).toBeInTheDocument();
    // The preview is read-only: nothing was injected.
    expect(useSimulationStore.getState().sim?.failures ?? []).toEqual([]);
  });

  it('is read-only while browsing history', async () => {
    renderApp('/dependencies?v=1&env=production&asof=fixture-0600&sel=service-instance:order-service.production');
    expect(await screen.findByRole('button', { name: 'Simulate this failure' })).toBeDisabled();
    expect(screen.getByText('Unavailable while browsing history.')).toBeInTheDocument();
  });

  it('shows the neighborhood on the map', async () => {
    const user = userEvent.setup();
    const router = renderApp('/dependencies?v=1&env=production&sel=service-instance:order-service.production');
    await user.click(await screen.findByRole('button', { name: 'Show neighborhood on map' }));
    expect(router.state.location.pathname).toBe('/map');
    expect(useUiStore.getState().neighborhood).toEqual({ centerId: 'order-service.production', depth: 1 });
  });
});

describe('infrastructure page', () => {
  beforeEach(resetUiStore);

  it('renders containment as a keyboard tree with roll-ups and selection', async () => {
    const user = userEvent.setup();
    renderApp('/infrastructure');
    const tree = await screen.findByRole('tree', { name: 'Infrastructure containment' });
    const items = within(tree).getAllByRole('treeitem');
    expect(items[0]).toHaveAttribute('tabindex', '0');
    expect(within(tree).getByRole('treeitem', { name: /^commerce-prod Account/ })).toHaveAttribute('aria-expanded', 'true');
    // Roll-up: the AWS region contains the degraded inventory database.
    expect(within(tree).getAllByLabelText('Health Degraded (worst inside)').length).toBeGreaterThan(0);
    // Other environments' resources are not shown.
    expect(within(tree).queryByText('eks-commerce-staging')).not.toBeInTheDocument();

    items[0]!.focus();
    await user.keyboard('{ArrowDown}');
    expect(items[1]).toHaveFocus();
    const account = within(tree).getByRole('treeitem', { name: /^commerce-prod Account/ });
    account.focus();
    await user.keyboard('{ArrowLeft}');
    expect(account).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard('{ArrowRight}');
    expect(account).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Enter}');
    expect(useUiStore.getState().selection).toEqual({ kind: 'resource', id: 'aws-acct-commerce-prod' });
    expect(account).toHaveAttribute('aria-selected', 'true');
  });

  it('applies the shared filters to the tree', async () => {
    renderApp('/infrastructure');
    const tree = await screen.findByRole('tree');
    act(() => useUiStore.getState().setFilters({ query: 'orders-db' }));
    expect(within(tree).getByText('orders-db')).toBeInTheDocument();
    expect(within(tree).queryByText('sessions-cache')).not.toBeInTheDocument();
  });

  it('opens the grouped map', async () => {
    const user = userEvent.setup();
    const router = renderApp('/infrastructure');
    await user.click(await screen.findByRole('button', { name: 'Show grouped on map' }));
    expect(router.state.location.pathname).toBe('/map');
    expect(useUiStore.getState()).toMatchObject({ layoutMode: 'infrastructure', activeView: '2d' });
  });
});

describe('settings page', () => {
  beforeEach(resetUiStore);

  it('saves preferences and applies the theme', async () => {
    const user = userEvent.setup();
    renderApp('/settings');
    const theme = await screen.findByRole('group', { name: 'Theme' });
    await user.click(within(theme).getByRole('button', { name: 'Light' }));
    expect(usePreferencesStore.getState().preferences.theme).toBe('light');
    expect(useUiStore.getState().theme).toBe('light');

    await user.click(within(screen.getByRole('group', { name: 'Default speed' })).getByRole('button', { name: '4×' }));
    expect(usePreferencesStore.getState().preferences.simulationSpeed).toBe('fast');
    expect(useSimulationStore.getState().speed).toBe('fast');

    await user.click(within(screen.getByRole('group', { name: '3D simulated traffic' })).getByRole('button', { name: 'Off' }));
    expect(usePreferencesStore.getState().preferences.galaxyTraffic).toBe(false);
  });

  it('applies the motion override app-wide', async () => {
    const user = userEvent.setup();
    renderApp('/settings');
    const motion = await screen.findByRole('group', { name: 'Motion' });
    await user.click(within(motion).getByRole('button', { name: 'Reduce' }));
    expect(document.documentElement.dataset.motion).toBe('reduce');
    await user.click(within(motion).getByRole('button', { name: 'Follow system' }));
    expect(document.documentElement.dataset.motion).toBeUndefined();
  });

  it('lists and deletes saved layouts', async () => {
    const user = userEvent.setup();
    const repo = createInMemorySavedLayoutRepository([
      {
        schemaVersion: 1,
        id: 'l1',
        name: 'Incident review',
        createdAt: '2026-10-11T09:00:00.000Z',
        view: { environmentId: 'production', layoutMode: 'topology', filters: { query: '', providers: [], health: [], groups: [] }, collapsedGroupIds: [] },
        positions: {},
      },
    ]);
    renderApp('/settings', undefined, repo);
    await user.click(await screen.findByRole('button', { name: 'Delete layout Incident review' }));
    expect(await screen.findByText('No saved layouts yet.')).toBeInTheDocument();
    expect(await repo.list()).toEqual([]);
  });

  it('resets view state but keeps preferences', async () => {
    const user = userEvent.setup();
    useUiStore.setState({ selection: { kind: 'resource', id: 'rds-orders-prod' }, layoutMode: 'infrastructure', galaxyScope: ['aws-use1-prod'] });
    usePreferencesStore.getState().update({ theme: 'light' });
    renderApp('/settings');
    await user.click(await screen.findByRole('button', { name: 'Reset view state' }));
    expect(useUiStore.getState()).toMatchObject({ selection: null, layoutMode: 'topology', galaxyScope: [] });
    expect(usePreferencesStore.getState().preferences.theme).toBe('light');
  });
});
