import { waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderApp, resetUiStore } from '../../test/renderApp';

const panel = (label: string) => {
  const element = document.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (!element) throw new Error(`No panel "${label}"`);
  return element;
};
const params = (router: ReturnType<typeof renderApp>) => new URLSearchParams(router.state.location.search);

describe('process view (ADR-028)', () => {
  beforeEach(resetUiStore);

  it('switches a line’s strip to its process, kept in the URL, as an ordered list that reads in words', async () => {
    const user = userEvent.setup();
    const router = renderApp('/services/payment-service/transit?v=1&env=production&line=A2');
    const strip = await waitFor(() => panel('Stop strip'));
    await user.click(within(strip).getByRole('button', { name: 'Process' }));
    await waitFor(() => expect(params(router).get('strip')).toBe('process'));
    const list = within(strip).getByRole('list', { name: 'Process of line A2' });
    expect(list).toHaveTextContent('Order Service calls gRPC ingress: rpc Capture(CaptureRequest) returns (Payment)');
    expect(list.querySelector('[data-fragment="loop"]')).toHaveTextContent('retry ×3');
    expect(list.querySelector('[data-fragment="transaction"]')).toHaveTextContent('write payment_outbox (transactional outbox)');
    // The endpoint is named on the map, and the index groups lines as endpoints.
    expect(panel('Map').querySelector('[data-endpoint="A2"]')).toHaveTextContent('rpc Capture(CaptureRequest) returns (Payment)');
    expect(panel('Lines')).toHaveTextContent('Endpoints · 11');
  });

  it('shows a flow’s process from the flow board', async () => {
    const router = renderApp('/flows/flow-checkout?v=1&env=production&strip=process');
    const strip = await waitFor(() => panel('Step strip'));
    const list = await within(strip).findByRole('list', { name: 'Process of Checkout' });
    expect(list.querySelector('[data-fragment="alt"]')).toHaveTextContent('[approved]');
    const undo = [...list.querySelectorAll('[data-fragment="compensation"]')].map((f) => f.textContent ?? '');
    expect(undo.some((t) => t.includes('undo with Void authorization'))).toBe(true);
    expect(undo.some((t) => t.includes('undo with Release stock'))).toBe(true);
    expect(params(router).get('strip')).toBe('process');
  });
});
