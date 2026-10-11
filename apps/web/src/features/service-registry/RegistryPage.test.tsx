import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { TopologyRepository } from '../../data/repositories/TopologyRepository';
import { useUiStore } from '../../state/uiStore';
import { renderApp, resetUiStore } from '../../test/renderApp';

async function registryTable() {
  return screen.findByRole('table', { name: /Registry entities in/ });
}

function rowNames(table: HTMLElement): string[] {
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0]!.textContent ?? '');
}

describe('service registry', () => {
  beforeEach(resetUiStore);

  it('lists production entities with a mock/simulated data label', async () => {
    renderApp('/registry');
    const table = await registryTable();
    expect(within(table).getByRole('button', { name: /Order Service\s*order-service\.production/ })).toBeInTheDocument();
    expect(within(table).queryByText('order-service.staging')).not.toBeInTheDocument();
    expect(within(table).getByText('topic-orders-events-prod')).toBeInTheDocument();
    expect(screen.getByText(/Mock inventory · simulated telemetry/i)).toBeInTheDocument();
  });

  it('scopes rows to the environment chosen in the header', async () => {
    const user = userEvent.setup();
    renderApp('/registry');
    await registryTable();
    await user.selectOptions(screen.getByLabelText('Environment'), 'staging');
    const table = await registryTable();
    expect(within(table).getByText('order-service.staging')).toBeInTheDocument();
    expect(within(table).queryByText('order-service.production')).not.toBeInTheDocument();
    expect(within(table).getByText('ext-card-processor')).toBeInTheDocument(); // environment-independent
  });

  it('searches, filters by chips, and shows a no-results state that can be cleared', async () => {
    const user = userEvent.setup();
    renderApp('/registry');
    const table = await registryTable();

    await user.type(screen.getByRole('searchbox', { name: /Search by name/ }), 'payments');
    expect(rowNames(table).every((text) => /payment|ledger|fraud|payout/i.test(text))).toBe(true);

    await user.click(within(screen.getByRole('group', { name: 'Kind' })).getByRole('button', { name: 'Messaging' }));
    expect(rowNames(table)).toEqual(['payments.eventstopic-payments-events-prod']);

    await user.click(within(screen.getByRole('group', { name: 'Health' })).getByRole('button', { name: /Unavailable/ }));
    expect(screen.getByText('No matches')).toBeInTheDocument();

    await user.click(within(screen.getByText('No matches').parentElement!).getByRole('button', { name: 'Clear filters' }));
    expect(useUiStore.getState().filters.query).toBe('');
    expect(rowNames(table).length).toBeGreaterThan(20);
  });

  it('sorts by a column and exposes the sort state', async () => {
    const user = userEvent.setup();
    renderApp('/registry');
    const table = await registryTable();
    const header = within(table).getByRole('columnheader', { name: /Resource/ });
    await user.click(within(header).getByRole('button'));
    expect(header).toHaveAttribute('aria-sort', 'ascending');
    const ascending = rowNames(table);
    await user.click(within(header).getByRole('button'));
    expect(header).toHaveAttribute('aria-sort', 'descending');
    expect(rowNames(table)).toEqual([...ascending].reverse());
  });

  it('selects by canonical kind and ID and shows canonical details with simulated telemetry', async () => {
    const user = userEvent.setup();
    renderApp('/registry');
    const table = await registryTable();
    await user.click(within(table).getByRole('button', { name: /Payment Service\s*payment-service\.production/ }));

    expect(useUiStore.getState().selection).toEqual({ kind: 'service-instance', id: 'payment-service.production' });
    const inspector = screen.getByRole('complementary', { name: 'Inspector' });
    expect(within(inspector).getByRole('heading', { name: 'Payment Service' })).toBeInTheDocument();
    expect(within(inspector).getByText('Azure')).toBeInTheDocument();
    expect(within(within(inspector).getByRole('region', { name: 'Telemetry' })).getByText('Simulated')).toBeInTheDocument();
    expect(within(inspector).getByText(/Simulated values, not observed telemetry/)).toBeInTheDocument();
    // Containment path is shown from explicit parent references.
    const path = within(inspector).getByRole('list', { name: 'Containment path' });
    expect(within(path).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'paymentsSubscription',
      'westeuropeRegion',
      'aks-payments-prodCluster',
      'paymentsNamespace',
    ]);
  });

  it('navigates relationships from the inspector to peers and connection details', async () => {
    const user = userEvent.setup();
    renderApp('/registry');
    const table = await registryTable();
    await user.click(within(table).getByRole('button', { name: /Order Service\s*order-service\.production/ }));
    const inspector = screen.getByRole('complementary', { name: 'Inspector' });

    await user.click(within(inspector).getByRole('button', { name: 'Connection details: Kafka with orders.events' }));
    expect(useUiStore.getState().selection).toEqual({
      kind: 'relationship',
      id: 'rel:order-service.production->topic-orders-events-prod',
    });
    expect(within(inspector).getByText('Asynchronous')).toBeInTheDocument();

    await user.click(within(inspector).getByRole('button', { name: /orders\.events\s*Target/ }));
    expect(useUiStore.getState().selection).toEqual({ kind: 'resource', id: 'topic-orders-events-prod' });
    expect(within(inspector).getByText('Kafka topic · topic-orders-events-prod')).toBeInTheDocument();
  });

  it('keeps the selection when switching to the map, and shows it in the shared inspector', async () => {
    const user = userEvent.setup();
    renderApp('/registry');
    const table = await registryTable();
    await user.click(within(table).getByRole('button', { name: /Fraud Scoring/ }));
    await user.click(screen.getByRole('link', { name: 'Service Map' }));
    const inspector = await screen.findByRole('complementary', { name: 'Inspector' });
    expect(within(inspector).getByRole('heading', { name: 'Fraud Scoring' })).toBeInTheDocument();
  });

  it('makes a selection hidden by filters or environment visible and recoverable', async () => {
    const user = userEvent.setup();
    renderApp('/registry');
    const table = await registryTable();
    await user.click(within(table).getByRole('button', { name: /Order Service\s*order-service\.production/ }));
    await user.type(screen.getByRole('searchbox', { name: /Search by name/ }), 'catalog');
    expect(screen.getByRole('status')).toHaveTextContent('Selected Order Service is hidden by the current filters.');
    await user.click(screen.getByRole('button', { name: 'Show it' }));
    expect(within(table).getByText('order-service.production')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Environment'), 'staging');
    expect(screen.getByText(/hidden by the current environment/)).toBeInTheDocument();
    const inspector = screen.getByRole('complementary', { name: 'Inspector' });
    await user.click(within(inspector).getByRole('button', { name: 'Switch to Production' }));
    expect(useUiStore.getState().environmentId).toBe('production');
  });

  it('shows a not-found state for a selection that does not exist', async () => {
    useUiStore.setState({ selection: { kind: 'service-instance', id: 'ghost' } });
    renderApp('/registry');
    expect(await screen.findByText('Selection not found')).toBeInTheDocument();
  });

  it('shows an error state when the repository fails', async () => {
    const failing: TopologyRepository = {
      sourceLabel: 'Broken',
      isMock: true,
      getTopology: () => Promise.reject(new Error('inventory unavailable')),
    };
    renderApp('/registry', failing);
    expect((await screen.findAllByRole('alert'))[0]).toHaveTextContent('inventory unavailable');
  });

  it('routes header search into the registry from pages without their own results', async () => {
    const user = userEvent.setup();
    const router = renderApp('/overview');
    await user.type(screen.getByRole('searchbox', { name: 'Search services and resources' }), 'ledger');
    expect(router.state.location.pathname).toBe('/registry');
    const table = await registryTable();
    expect(rowNames(table).every((text) => /ledger/i.test(text))).toBe(true);
  });
});
