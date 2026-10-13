import { waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderApp, resetUiStore } from '../../test/renderApp';

/** Role queries over the whole board are slow in jsdom (the map); toggles are found by their data hook. */
const toggleFor = (root: HTMLElement, endpoint: string) =>
  waitFor(() => {
    const button = root.querySelector<HTMLButtonElement>(`[data-contract-toggle="${endpoint}"]`);
    if (!button) throw new Error(`No contract toggle for ${endpoint}`);
    return button;
  });

const panel = (label: string) => {
  const element = document.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (!element) throw new Error(`No panel "${label}"`);
  return element;
};

describe('endpoint contracts (ADR-029)', () => {
  beforeEach(resetUiStore);

  it('shows Place order’s OpenAPI contract in its step detail', async () => {
    renderApp('/flows/flow-checkout?v=1&env=production&step=place-order');
    const card = await waitFor(() => panel('Flow card'));
    const contract = await within(card).findByRole('region', { name: 'Contract of Place order' });
    await waitFor(() => expect(contract.querySelector('[data-contract="POST /v1/orders"]')).not.toBeNull());
    expect(contract).toHaveTextContent('From order-service.openapi.json (Order Service API 7.0.3)');
    expect(contract).toHaveTextContent('example spec');
    expect(contract.querySelector('[data-field="Idempotency-Key"]')).toHaveTextContent(/Idempotency-Key\s*string\s*required\s*header · uuid/);
    expect(contract.querySelector('[data-field="items"]')).toHaveTextContent(/items\s*OrderItem\[\]\s*required\s*min items 1/);
    expect([...contract.querySelectorAll('[data-response]')].map((r) => r.getAttribute('data-response'))).toEqual(['201', '400', '409']);
    expect(contract.querySelector('[data-response="201"]')).toHaveTextContent('Order placed.');
    expect(within(contract).getByLabelText('Example request')).toHaveTextContent('"sku": "SKU-1042"');
  });

  it('says what a non-HTTP step is instead of showing nothing', async () => {
    renderApp('/flows/flow-checkout?v=1&env=production&step=authorize-payment');
    const card = await waitFor(() => panel('Flow card'));
    const contract = await within(card).findByRole('region', { name: 'Contract of Authorize payment' });
    await waitFor(() => expect(contract).toHaveTextContent('gRPC, declared in payments.proto: only OpenAPI (HTTP) contracts are shown.'));
  });

  it('opens a contract from a process arrow: the flow’s start and the webhook line', async () => {
    const user = userEvent.setup();
    renderApp('/flows/flow-checkout?v=1&env=production&strip=process');
    const strip = await waitFor(() => panel('Step strip'));
    const toggle = await toggleFor(strip, 'POST /v1/orders');
    expect(toggle).toHaveAccessibleName('Show the API contract of POST /v1/orders');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(strip.querySelector('[data-contract="POST /v1/orders"]')).not.toBeNull());
    // Only HTTP endpoints have a toggle: the start (POST /v1/orders) and the webhook-driven settlement.
    expect([...strip.querySelectorAll('[data-contract-toggle]')].map((b) => b.getAttribute('data-contract-toggle'))).toEqual(['POST /v1/orders', 'POST /webhooks/processor']);
  });

  it('shows the webhook’s event variants from its line’s first arrow', async () => {
    const user = userEvent.setup();
    renderApp('/services/payment-service/transit?v=1&env=production&line=W1&strip=process');
    const strip = await waitFor(() => panel('Stop strip'));
    await user.click(await toggleFor(strip, 'POST /webhooks/processor'));
    const contract = await waitFor(() => {
      const c = strip.querySelector<HTMLElement>('[data-contract="POST /webhooks/processor"]');
      if (!c) throw new Error('not yet');
      return c;
    });
    expect(contract).toHaveTextContent('One of 2:');
    expect(contract).toHaveTextContent('SettlementEvent');
    expect(contract).toHaveTextContent('ChargebackEvent');
    expect(contract.querySelector('[data-field="X-Processor-Signature"]')).toHaveTextContent('required');
  });
});
