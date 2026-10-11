import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useSimulationStore } from '../../state/simulationStore';
import { useUiStore } from '../../state/uiStore';
import { renderApp, resetUiStore } from '../../test/renderApp';

const inspector = () => screen.getByRole('complementary', { name: 'Inspector' });
const registryRow = (id: string) => screen.getByText(id).closest('tr') as HTMLElement;
const simReady = () => waitFor(() => expect(useSimulationStore.getState().sim).not.toBeNull());

describe('simulation across views', () => {
  beforeEach(resetUiStore);

  it('reflects one injected failure consistently in registry, inspector, map, and event log', async () => {
    const user = userEvent.setup();
    const router = renderApp('/registry?v=1&env=production&sel=service-instance:payment-service.production');
    await screen.findByRole('table');
    await user.click(within(inspector()).getByRole('button', { name: 'Simulate outage' }));

    // Registry: root and propagated impact.
    expect(within(registryRow('payment-service.production')).getByText('Unavailable')).toBeInTheDocument();
    expect(within(registryRow('order-service.production')).getByText('Degraded')).toBeInTheDocument();

    // Inspector explains the impact with rule and cause.
    await user.click(within(registryRow('order-service.production')).getByRole('button'));
    expect(within(inspector()).getByText(/because/)).toHaveTextContent(
      'Degraded because Payment Service failed (HTTPS, synchronous). Rule: Synchronous dependency.',
    );

    // Map: same health on the node.
    await act(() => router.navigate({ pathname: '/map', search: router.state.location.search }));
    expect(await screen.findByLabelText(/^Payment Service, api, health unavailable/)).toBeInTheDocument();
    expect(await screen.findByLabelText(/^Order Service, api, health degraded/)).toBeInTheDocument();

    // Event log: root event and the explained propagation, labeled simulated.
    await act(() => router.navigate({ pathname: '/simulation', search: router.state.location.search }));
    const log = await screen.findByRole('list', { name: 'Simulated events, newest first' });
    expect(within(log).getByText('Payment Service: simulated failure, Healthy → Unavailable')).toBeInTheDocument();
    expect(within(log).getByText('Caused by Payment Service over HTTPS (synchronous). Rule: Synchronous dependency.')).toBeInTheDocument();
    expect(within(log).getAllByText('Simulated').length).toBe(within(log).getAllByRole('listitem').length);
  });

  it('injects from the Events page with scheduled recovery, and steps the simulated clock', async () => {
    const user = userEvent.setup();
    renderApp('/simulation');
    await simReady();
    await user.selectOptions(await screen.findByLabelText('Fail'), 'rds-orders-prod');
    await user.selectOptions(screen.getByLabelText('Auto-recover'), '30 s');
    await user.click(screen.getByRole('button', { name: 'Inject failure' }));
    expect(useSimulationStore.getState().sim?.failures).toEqual([
      { entityId: 'rds-orders-prod', mode: 'unavailable', injectedTick: 0, recoverAtTick: 3 },
    ]);
    expect(screen.getByRole('list', { name: 'Simulated events, newest first' })).toHaveTextContent('orders-db: simulated failure');

    for (let i = 0; i < 3; i++) await user.click(screen.getByRole('button', { name: 'Step 10 s' }));
    expect(useSimulationStore.getState().sim?.failures).toEqual([]);
    expect(screen.getByLabelText('Simulated clock')).toHaveTextContent('08:45:30 UTC · tick 3');
    expect(screen.getByText('orders-db: recovered, Unavailable → Healthy')).toBeInTheDocument();
  });

  it('does not relayout the map when only health changes', async () => {
    renderApp('/map');
    const node = await screen.findByLabelText(/^Order Service, api/);
    await waitFor(() => expect(node.style.transform).not.toBe(''));
    const before = node.style.transform;
    act(() => useSimulationStore.getState().inject('payment-service.production', 'unavailable'));
    act(() => useSimulationStore.getState().step());
    expect(await screen.findByLabelText(/^Order Service, api, health degraded/)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 200)); // longer than the layout debounce
    expect((await screen.findByLabelText(/^Order Service, api/)).style.transform).toBe(before);
  });
});

describe('history', () => {
  beforeEach(resetUiStore);

  it('browses a snapshot read-only without changing current or simulated state', async () => {
    const user = userEvent.setup();
    const router = renderApp('/simulation');
    await simReady();
    act(() => useSimulationStore.getState().inject('payment-service.production', 'unavailable'));
    const simBefore = useSimulationStore.getState().sim;

    const snapshots = await screen.findByRole('list', { name: 'Snapshots' });
    const row = within(snapshots).getByText('Before incident').closest('li') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'View as of' }));
    expect(await screen.findByText(/Viewing history:/)).toHaveTextContent('Viewing history: Before incident as of 11 Oct, 06:00 UTC · fixture, simulated data · read-only');
    expect(new URLSearchParams(router.state.location.search).get('asof')).toBe('fixture-0600');

    // Registry shows the snapshot: notification was healthy, payment not failed, email dispatcher absent.
    await act(() => router.navigate({ pathname: '/registry', search: router.state.location.search }));
    await screen.findByRole('table');
    expect(within(registryRow('notification-service.production')).getByText('Healthy')).toBeInTheDocument();
    expect(within(registryRow('payment-service.production')).getByText('Healthy')).toBeInTheDocument();
    expect(screen.queryByText('email-dispatcher.production')).not.toBeInTheDocument();
    // Inspector offers no simulation actions in history.
    await user.click(within(registryRow('payment-service.production')).getByRole('button'));
    expect(within(inspector()).queryByRole('button', { name: 'Simulate outage' })).not.toBeInTheDocument();

    // Current/simulated state untouched.
    expect(useSimulationStore.getState().sim).toBe(simBefore);

    await user.click(screen.getByRole('button', { name: 'Return to current' }));
    expect(within(registryRow('payment-service.production')).getByText('Unavailable')).toBeInTheDocument();
    expect(screen.queryByText(/Viewing history:/)).not.toBeInTheDocument();

    // Back returns to the snapshot.
    await act(() => router.navigate(-1));
    expect(useUiStore.getState().asOf).toBe('fixture-0600');
  });

  it('compares a snapshot with the current simulated state', async () => {
    const user = userEvent.setup();
    renderApp('/simulation');
    await simReady();
    await screen.findByRole('list', { name: 'Snapshots' });
    await user.selectOptions(screen.getByLabelText('From'), 'fixture-0600');
    await user.selectOptions(screen.getByLabelText('To'), 'Current (simulated)');
    await user.click(screen.getByRole('button', { name: 'Compare' }));
    const diff = await screen.findByRole('list', { name: 'Differences' });
    const notification = within(diff).getByRole('button', { name: 'Notification Service' }).closest('li') as HTMLElement;
    expect(notification).toHaveTextContent('Healthy → Unavailable');
    expect(diff).toHaveTextContent('Email Dispatcher');
    expect(diff).toHaveTextContent('Added (service instance)');
  });

  it('captures the current simulated state as a snapshot', async () => {
    const user = userEvent.setup();
    renderApp('/simulation');
    await simReady();
    await screen.findByRole('list', { name: 'Snapshots' });
    await user.click(screen.getByRole('button', { name: 'Capture current state' }));
    const list = await screen.findByRole('list', { name: 'Snapshots' });
    expect(await within(list).findByText('Simulation capture · 08:45:00 UTC')).toBeInTheDocument();
    expect(within(list).getByText(/simulation capture/)).toBeInTheDocument();
  });

  it('reports a missing snapshot and shows current state', async () => {
    renderApp('/registry?v=1&env=production&asof=nope');
    expect(await screen.findByText(/was not found/)).toBeInTheDocument();
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });
});

describe('labeling', () => {
  beforeEach(resetUiStore);

  it.each(['/simulation', '/map', '/registry'])('%s never describes mock data as live telemetry', async (path) => {
    renderApp(path);
    await simReady();
    await screen.findByRole('link', { name: /Simulated\s*.*simulation paused/ });
    expect(document.body.textContent).not.toMatch(/\blive\b/i);
  });

  it('shows simulation status in the header and links to Simulation', async () => {
    const router = renderApp('/map');
    await simReady();
    act(() => useSimulationStore.getState().inject('ext-card-processor', 'unavailable'));
    const chip = await screen.findByRole('link', { name: /Simulated\s*08:45:00 UTC.*1 failing.*simulation paused/ });
    fireEvent.click(chip);
    expect(router.state.location.pathname).toBe('/simulation');
  });
});
