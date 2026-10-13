import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderApp, resetUiStore } from '../../test/renderApp';

/** Milestone 13.2: which line each step uses, and the step card's drill-down into the service. */

const params = (router: ReturnType<typeof renderApp>) => new URLSearchParams(router.state.location.search);
const table = () => screen.findByRole('table', { name: 'Which line each step uses' });

describe('flow board: which line each step uses', () => {
  beforeEach(resetUiStore);

  it('lists every step with its line, or why it has none, and a summary', async () => {
    renderApp('/flows/flow-checkout?v=1&env=production&strip=lines');
    const lines = await table();
    await waitFor(() => expect(within(lines).getAllByRole('row').filter((r) => r.getAttribute('data-status') === 'mapped')).toHaveLength(4));
    const rowOf = (id: string) => lines.querySelector(`[data-step-line="${id}"]`) as HTMLElement;
    expect(rowOf('capture-payment')).toHaveTextContent('A2');
    expect(rowOf('capture-payment')).toHaveTextContent('rpc Capture(CaptureRequest) returns (Payment)');
    expect(rowOf('reserve-stock')).toHaveTextContent('no board');
    expect(within(lines).getAllByRole('row')).toHaveLength(13); // header + 12 steps
    expect(screen.getByText(/of 12 steps enter a known line, on 1 of 6 services’ boards\./)).toBeInTheDocument();
  });

  it('selects a step from the table and shows its line stop by stop, with the way to the board', async () => {
    const user = userEvent.setup();
    const router = renderApp('/flows/flow-checkout?v=1&env=production&strip=lines');
    const lines = await table();
    await user.click(await within(lines).findByRole('button', { name: 'Capture payment' }));
    expect(params(router).get('step')).toBe('capture-payment');
    expect(await screen.findByRole('list', { name: 'Stops on line A2' })).toBeInTheDocument();
    const open = screen.getAllByRole('link', { name: 'Open line A2 on the Payment Service board' })[0];
    expect(open).toHaveAttribute('href', expect.stringMatching(/^\/services\/payment-service\/transit\?.*line=A2.*flow=flow-checkout/));
  });

  it('the step card shows what the step does inside its service, or why it cannot', async () => {
    renderApp('/flows/flow-checkout?v=1&env=production&step=capture-payment');
    const inside = await screen.findByRole('region', { name: 'Inside Payment Service' });
    expect(within(inside).getByRole('list', { name: 'Route of line A2' })).toBeInTheDocument();
    expect(within(inside).getByRole('link', { name: 'Open line A2 on the Payment Service board' })).toBeInTheDocument();
  });

  it('explains a step in a service without a board', async () => {
    renderApp('/flows/flow-checkout?v=1&env=production&step=reserve-stock');
    const inside = await screen.findByRole('region', { name: 'Inside Inventory Service' });
    expect(inside).toHaveTextContent('This service has no transit board yet.');
    expect(within(inside).getByRole('link', { name: 'Open the Inventory Service board' })).toBeInTheDocument();
  });
});
