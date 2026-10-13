import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from '../../state/uiStore';
import { renderApp, resetUiStore } from '../../test/renderApp';

const field = () => screen.getByRole('combobox', { name: 'Search services, flows, events, endpoints, and pages' });
const option = (name: RegExp) => within(screen.getByRole('listbox', { name: 'Results' })).getByRole('option', { name });

describe('quick search (ADR-033)', () => {
  beforeEach(resetUiStore);

  it('opens with Ctrl+K from anywhere, lists pages, and closes with Escape', async () => {
    const user = userEvent.setup();
    renderApp('/overview?v=1&env=production');
    await screen.findByRole('heading', { name: 'Overview', level: 1 });
    await user.keyboard('{Control>}k{/Control}');
    expect(field()).toHaveFocus();
    expect(option(/^Settings/)).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Search' })).not.toBeInTheDocument();
  });

  it('opens a business flow with Enter, without navigating while typing', async () => {
    const user = userEvent.setup();
    const router = renderApp('/overview?v=1&env=production');
    await user.click(await screen.findByRole('button', { name: 'Search services, flows, events' }));
    await user.type(field(), 'checkout');
    expect(router.state.location.pathname).toBe('/overview');
    expect(option(/^Checkout/)).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Enter}');
    expect(router.state.location.pathname).toBe('/flows/flow-checkout');
  });

  it('selects an entity in the registry, moving through results with the arrow keys', async () => {
    const user = userEvent.setup();
    const router = renderApp('/overview?v=1&env=production');
    await user.click(await screen.findByRole('button', { name: 'Search services, flows, events' }));
    await user.type(field(), 'ledger');
    const ledger = option(/^Ledger Service/);
    // The first option is active; move down to the Ledger Service option and open it.
    const options = within(screen.getByRole('listbox', { name: 'Results' })).getAllByRole('option');
    for (let i = 0; i < options.indexOf(ledger); i++) await user.keyboard('{ArrowDown}');
    expect(field()).toHaveAttribute('aria-activedescendant', ledger.id);
    await user.keyboard('{Enter}');
    expect(router.state.location.pathname).toBe('/registry');
    expect(useUiStore.getState().selection).toEqual({ kind: 'service-instance', id: 'ledger-service.production' });
  });

  it('opens an endpoint on its service board, and an event type in the catalog', async () => {
    const user = userEvent.setup();
    const router = renderApp('/map?v=1&env=production');
    await user.click(await screen.findByRole('button', { name: 'Search services, flows, events' }));
    await user.type(field(), 'capture');
    await user.click(await screen.findByRole('option', { name: /^A2 Capture/ }));
    expect(router.state.location.pathname).toBe('/services/payment-service/transit');
    expect(new URLSearchParams(router.state.location.search).get('line')).toBe('A2');

    await user.keyboard('{Control>}k{/Control}');
    await user.type(field(), 'orderplaced');
    await user.click(option(/^OrderPlaced/));
    expect(router.state.location.pathname).toBe('/events/event-order-placed');
  });

  it('filters the registry only when asked to', async () => {
    const user = userEvent.setup();
    const router = renderApp('/overview?v=1&env=production');
    await user.click(await screen.findByRole('button', { name: 'Search services, flows, events' }));
    await user.type(field(), 'ledger');
    expect(useUiStore.getState().filters.query).toBe('');
    await user.click(option(/^Filter the registry for “ledger”/));
    expect(router.state.location.pathname).toBe('/registry');
    expect(useUiStore.getState().filters.query).toBe('ledger');
    const table = await screen.findByRole('table');
    await waitFor(() => expect(within(table).getAllByRole('row').slice(1).every((row) => /ledger/i.test(row.textContent ?? ''))).toBe(true));
  });

  it('says when nothing matches', async () => {
    const user = userEvent.setup();
    renderApp('/overview?v=1&env=production');
    await user.click(await screen.findByRole('button', { name: 'Search services, flows, events' }));
    await user.type(field(), 'zzzz');
    expect(screen.getByText(/Nothing is named “zzzz”/)).toBeInTheDocument();
    expect(option(/^Filter the registry/)).toBeInTheDocument();
  });
});
