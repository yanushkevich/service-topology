import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from '../../state/uiStore';
import { renderApp, resetUiStore } from '../../test/renderApp';

/** Event catalog and event-flow highlight (PRODUCT_SPEC Revision 6 §M.2–M.3). */

const eventList = () => screen.findByRole('list', { name: 'Event types' });
const listedNames = (list: HTMLElement) => within(list).getAllByRole('link').map((a) => a.querySelector('span')?.textContent);
const findNode = (name: string) => screen.findByLabelText(new RegExp(`^${name}, `));
const emphasis = (wrapper: HTMLElement) => {
  const value = (wrapper.firstElementChild as HTMLElement).dataset.emphasis;
  return value === 'none' && wrapper.closest('.topology-dim-others') ? 'dimmed' : value;
};

describe('events catalog', () => {
  beforeEach(resetUiStore);

  it('lists the environment’s event types, shows the first, and searches by event or channel', async () => {
    const user = userEvent.setup();
    renderApp('/events');
    const list = await eventList();
    expect(listedNames(list)).toHaveLength(9);
    expect(screen.getByText('9 events · Production')).toBeInTheDocument();
    expect(within(list).getByRole('link', { current: 'page' })).toHaveTextContent('NotificationRequested');
    expect(screen.getByRole('heading', { level: 2, name: 'NotificationRequested' })).toBeInTheDocument();

    const search = screen.getByRole('searchbox', { name: 'Search events' });
    await user.type(search, 'payments.events');
    expect(listedNames(await eventList())).toEqual(['PaymentCaptured', 'PaymentFailed', 'RefundIssued']);
    await user.clear(search);
    await user.type(search, 'nothing-like-this');
    expect(screen.getByText(/No events match/)).toBeInTheDocument();
  });

  it('shows producers → channel → consumers, including a consumer reading from a bound queue', async () => {
    const user = userEvent.setup();
    renderApp('/events/event-notification-requested');
    const producers = await screen.findByRole('list', { name: /^Producers/ });
    expect(within(producers).getByRole('button', { name: /Notification Service.*publishes/ })).toBeInTheDocument();
    const consumers = screen.getByRole('list', { name: /^Consumers/ });
    expect(within(consumers).getByText('notifications.email')).toBeInTheDocument();
    expect(screen.getByText('schema v1')).toBeInTheDocument();

    await user.click(within(consumers).getByRole('button', { name: /Email Dispatcher/ }));
    expect(useUiStore.getState().selection).toEqual({ kind: 'service-instance', id: 'email-dispatcher.production' });
    await user.click(screen.getByRole('button', { name: 'NotificationRequested carried on notifications (Exchange). Select the channel. Healthy' }));
    expect(useUiStore.getState().selection).toEqual({ kind: 'resource', id: 'exchange-notifications-prod' });
  });

  it('shows empty and not-deployed states per environment', async () => {
    renderApp('/events/event-payment-failed');
    expect(await screen.findByText('No consumers are modeled for this event.')).toBeInTheDocument();
  });

  it('resolves the selected environment’s channel and instances', async () => {
    renderApp('/events/event-order-placed?v=1&env=staging');
    expect(listedNames(await eventList())).toEqual(['OrderCancelled', 'OrderPlaced', 'OrderShipped']);
    expect(screen.getByText('Not deployed in Staging')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /carried on orders\.events/ })).toBeInTheDocument();
  });

  it('says when the linked event is not carried in the environment or does not exist', async () => {
    renderApp('/events/event-payment-captured?v=1&env=staging');
    expect(await screen.findByText(/PaymentCaptured is not carried in Staging/)).toBeInTheDocument();
  });

  it('reports an unknown event ID', async () => {
    renderApp('/events/ghost');
    expect(await screen.findByText(/No event type with ID “ghost”/)).toBeInTheDocument();
  });

  it('honors history mode', async () => {
    renderApp('/events?v=1&env=production&asof=fixture-0600');
    expect(listedNames(await eventList())).toHaveLength(9);
    expect(await screen.findByText(/Viewing history:/)).toBeInTheDocument();
  });
});

describe('event-flow highlight on the map', () => {
  beforeEach(resetUiStore);

  it('highlights exactly the flow in 2D, yields to a selection, and clears from the chip', async () => {
    const user = userEvent.setup();
    useUiStore.setState({ selection: { kind: 'service-instance', id: 'ledger-service.production' } });
    const router = renderApp('/events/event-order-placed');
    await user.click(await screen.findByRole('button', { name: 'Highlight in 2D' }));
    expect(router.state.location.pathname).toBe('/map');
    expect(useUiStore.getState()).toMatchObject({ eventHighlight: 'event-order-placed', selection: null, activeView: '2d' });
    expect(new URLSearchParams(router.state.location.search).get('ev')).toBe('event-order-placed');

    await waitFor(async () => expect(emphasis(await findNode('Order Service'))).toBe('highlighted'));
    expect(emphasis(await findNode('orders\\.events'))).toBe('highlighted');
    expect(emphasis(await findNode('Inventory Service'))).toBe('highlighted');
    expect(emphasis(await findNode('Ledger Service'))).toBe('dimmed');
    const chip = screen.getByText(/Event flow:/).closest<HTMLElement>('[role="status"]')!;
    expect(within(chip).getByRole('link', { name: 'OrderPlaced' })).toBeInTheDocument();

    fireEvent.click(await findNode('Ledger Service'));
    await waitFor(async () => expect(emphasis(await findNode('Ledger Service'))).toBe('selected'));
    expect(screen.getByText(/paused while something is selected/)).toBeInTheDocument();

    act(() => useUiStore.getState().select(null));
    await user.click(screen.getByRole('button', { name: 'Clear event highlight OrderPlaced' }));
    expect(useUiStore.getState().eventHighlight).toBeNull();
    await waitFor(async () => expect(emphasis(await findNode('Ledger Service'))).toBe('none'));
  });

  it('applies a highlight from a shared link', async () => {
    renderApp('/map?v=1&env=production&ev=event-stock-reserved');
    await waitFor(async () => expect(emphasis(await findNode('Catalog Service'))).toBe('highlighted'));
    expect(emphasis(await findNode('Order Service'))).toBe('dimmed');
  });

  it('opens the 3D view from the catalog', async () => {
    const user = userEvent.setup();
    useUiStore.setState({ galaxyScope: ['aws-acct-commerce-prod'] });
    renderApp('/events/event-order-placed');
    await user.click(await screen.findByRole('button', { name: 'Show in 3D galaxy' }));
    expect(useUiStore.getState()).toMatchObject({ activeView: '3d', eventHighlight: 'event-order-placed', galaxyScope: [] });
  });
});

describe('inspector: events carried by a channel', () => {
  beforeEach(resetUiStore);

  it('lists the event types on a topic and links to the catalog', async () => {
    const user = userEvent.setup();
    useUiStore.setState({ selection: { kind: 'resource', id: 'topic-orders-events-prod' } });
    const router = renderApp('/registry');
    const link = await screen.findByRole('link', { name: /OrderShipped/ });
    await user.click(link);
    expect(router.state.location.pathname).toBe('/events/event-order-shipped');
    expect(await screen.findByRole('heading', { level: 2, name: 'OrderShipped' })).toBeInTheDocument();
  });
});
