import { fireEvent, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderApp, resetUiStore } from '../../test/renderApp';

const panel = (label: string) => {
  const element = document.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (!element) throw new Error(`No panel "${label}"`);
  return element;
};

describe('data stores on the flow board (ADR-027)', () => {
  beforeEach(resetUiStore);

  it('shows each step’s service stores, names the database of outbox and inbox, and lists the stores', async () => {
    renderApp('/flows/flow-checkout?v=1&env=production');
    const card = await waitFor(() => panel('Flow card'));
    const map = panel('Map');
    const storesOf = (step: string) => [...map.querySelectorAll(`[data-step="${step}"] [data-store]`)].map((s) => s.getAttribute('data-store'));
    expect(storesOf('place-order')).toEqual(['rds-orders-prod']);
    expect(storesOf('reserve-stock')).toEqual(['rds-inventory-prod']);
    expect(storesOf('capture-payment')).toEqual(['pg-payments-prod']);
    expect(storesOf('post-to-ledger')).toEqual(['pg-ledger-prod']);
    // Each chip carries the store's health in words for assistive technology.
    expect(map.querySelector('[data-step="place-order"] [data-store]')).toHaveTextContent(/Healthy.*orders-db/);
    expect(storesOf('notify-customer')).toEqual([]);

    // settled: outbox (0) and polling publisher (1) on Payment Service; inbox (4) on Ledger Service.
    fireEvent.pointerEnter(map.querySelector('[data-stop="flow-checkout:settled:0"]')!);
    expect(within(map).getByRole('tooltip')).toHaveTextContent('in payments-db');
    fireEvent.pointerEnter(map.querySelector('[data-stop="flow-checkout:settled:4"]')!);
    expect(within(map).getByRole('tooltip')).toHaveTextContent(/Inbox.*in ledger-db/);

    const stores = within(card).getByRole('region', { name: 'Data stores' });
    expect(stores.querySelector('[data-flow-store="rds-orders-prod"]')).toHaveTextContent('used by Place order, Ship order, Cancel order');
    expect(within(stores).getByRole('link', { name: 'ledger-db' })).toHaveAttribute('href', expect.stringContaining('sel=resource%3Apg-ledger-prod'));
  });
});
