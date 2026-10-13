import { fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderApp, resetUiStore } from '../../test/renderApp';

const panel = (label: string) => {
  const element = document.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (!element) throw new Error(`No panel "${label}"`);
  return element;
};
const params = (router: ReturnType<typeof renderApp>) => new URLSearchParams(router.state.location.search);
const BOARD = '/services/payment-service/transit?v=1&env=production&window=7d';

describe('business flows on the service board (ADR-023)', () => {
  beforeEach(resetUiStore);

  it('lists the flows that run on the service and highlights the lines a flow enters', async () => {
    const user = userEvent.setup();
    const router = renderApp(BOARD);
    const index = await waitFor(() => panel('Lines'));
    const flows = await within(index).findByRole('region', { name: 'Business flows, 2' });
    expect(within(flows).getAllByRole('button').map((b) => b.textContent)).toEqual(['CHCheckout4 steps here', 'RERefund1 step here']);

    await user.click(within(flows).getByRole('button', { name: /Checkout/ }));
    await waitFor(() => expect(params(router).get('flow')).toBe('flow-checkout'));
    const map = panel('Map');
    const lit = [...map.querySelectorAll('[data-line][data-state="normal"]')].map((l) => l.getAttribute('data-line'));
    // Checkout's Payment Service steps: Authorize, Capture, Void, and the processor webhook.
    expect(lit.sort()).toEqual(['A1', 'A2', 'A4', 'W1']);
    expect(map.querySelector('[data-line="A3"]')).toHaveAttribute('data-state', 'dim');

    // Escape clears the flow (no line is selected).
    fireEvent.keyDown(index, { key: 'Escape' });
    await waitFor(() => expect(params(router).get('flow')).toBeNull());
    expect(map.querySelector('[data-line="A3"]')).toHaveAttribute('data-state', 'normal');
  });

  it('links a line back to the flow steps that use it, keeping the environment and window', async () => {
    const user = userEvent.setup();
    const router = renderApp(`${BOARD}&line=A2`);
    const card = await waitFor(() => panel('Line card'));
    const usedBy = await within(card).findByRole('region', { name: 'Used by business flows' });
    await user.click(within(usedBy).getByRole('link', { name: 'Checkout: Capture payment' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/flows/flow-checkout'));
    expect(params(router).get('step')).toBe('capture-payment');
    expect(params(router).get('env')).toBe('production');
    expect(params(router).get('window')).toBe('7d');
    expect(params(router).get('line')).toBeNull();
  });

  it('opens from a flow step with that flow highlighted', async () => {
    const user = userEvent.setup();
    const router = renderApp('/flows/flow-checkout?v=1&env=production&step=authorize-payment');
    const card = await waitFor(() => panel('Flow card'));
    await user.click(await within(card).findByRole('link', { name: 'Open line A1 on the Payment Service board' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/services/payment-service/transit'));
    expect(params(router).get('flow')).toBe('flow-checkout');
    await waitFor(() => expect(within(panel('Lines')).getByRole('button', { name: /Checkout/ })).toHaveAttribute('aria-pressed', 'true'));
  });
});

describe('flows are findable from every service board (ADR-027)', () => {
  beforeEach(resetUiStore);

  it('toggles a flow from the "Used by" chips, and lists flows first in the index', async () => {
    const user = userEvent.setup();
    const router = renderApp(BOARD);
    const chips = await waitFor(() => panel('Used by business flows'));
    await user.click(within(chips).getByRole('button', { name: /Checkout/ }));
    await waitFor(() => expect(params(router).get('flow')).toBe('flow-checkout'));
    expect(within(chips).getByRole('button', { name: /Checkout/ })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(chips).getByRole('button', { name: /Checkout/ }));
    await waitFor(() => expect(params(router).get('flow')).toBeNull());
    // The flow group comes right after "All lines".
    const regions = within(panel('Lines')).getAllByRole('region').map((r) => r.getAttribute('aria-label'));
    expect(regions[0]).toBe('Business flows, 2');
  });

  it('lists the flows of a service that has no board data, with links to their steps', async () => {
    renderApp('/services/order-service/transit?v=1&env=production');
    const section = await waitFor(() => panel('Business flows on this service'));
    const links = within(section).getAllByRole('link').map((a) => a.textContent);
    expect(links).toEqual(expect.arrayContaining(['Checkout: Place order', 'Checkout: Ship order', 'Checkout: Cancel order', 'Refund: Request refund']));
  });
});
