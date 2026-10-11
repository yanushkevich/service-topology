import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderApp, resetUiStore } from '../test/renderApp';
import { useUiStore } from './uiStore';

const params = (router: ReturnType<typeof renderApp>) => new URLSearchParams(router.state.location.search);

describe('URL state sync', () => {
  beforeEach(resetUiStore);

  it('applies a deep link to shared state', async () => {
    renderApp('/registry?v=1&env=staging&sel=service-instance:order-service.staging&kind=service&hl=downstream');
    const inspector = await screen.findByRole('complementary', { name: 'Inspector' });
    expect(await within(inspector).findByRole('heading', { name: 'Order Service' })).toBeInTheDocument();
    expect(useUiStore.getState()).toMatchObject({
      environmentId: 'staging',
      selection: { kind: 'service-instance', id: 'order-service.staging' },
      filters: { groups: ['service'] },
      highlightMode: 'downstream',
    });
  });

  it('writes state into a bare URL on first load', async () => {
    const router = renderApp('/registry');
    await screen.findByRole('table');
    expect(params(router).get('v')).toBe('1');
    expect(params(router).get('env')).toBe('production');
  });

  it('records selections in history; back/forward restore them', async () => {
    const user = userEvent.setup();
    const router = renderApp('/registry');
    const table = await screen.findByRole('table');
    await user.click(within(table).getByRole('button', { name: /Payment Service\s*payment-service\.production/ }));
    await user.click(within(table).getByRole('button', { name: /Ledger Service\s*ledger-service\.production/ }));
    expect(params(router).get('sel')).toBe('service-instance:ledger-service.production');

    await act(() => router.navigate(-1));
    expect(useUiStore.getState().selection).toEqual({ kind: 'service-instance', id: 'payment-service.production' });
    await act(() => router.navigate(-1));
    expect(useUiStore.getState().selection).toBeNull();
    await act(() => router.navigate(1));
    expect(useUiStore.getState().selection).toEqual({ kind: 'service-instance', id: 'payment-service.production' });
  });

  it('replaces (not pushes) history while typing a search', async () => {
    const user = userEvent.setup();
    const router = renderApp('/registry');
    await screen.findByRole('table');
    const before = router.state.historyAction;
    await user.type(screen.getByRole('searchbox', { name: /Search by name/ }), 'ledger');
    expect(params(router).get('q')).toBe('ledger');
    expect(router.state.historyAction).toBe('REPLACE');
    expect(before).toBe('REPLACE'); // the initial canonicalization
  });

  it('keeps state across section navigation', async () => {
    const user = userEvent.setup();
    const router = renderApp('/registry?v=1&env=production&sel=service-instance:fraud-scoring.production');
    await screen.findByRole('table');
    await user.click(screen.getByRole('link', { name: /Dependencies/ }));
    expect(router.state.location.pathname).toBe('/dependencies');
    expect(params(router).get('sel')).toBe('service-instance:fraud-scoring.production');
    expect(useUiStore.getState().selection?.id).toBe('fraud-scoring.production');
  });

  it('shows a not-found state for unknown IDs and falls back from unknown environments', async () => {
    renderApp('/registry?v=1&env=mars&sel=service-instance:ghost');
    expect(await screen.findByText('Selection not found')).toBeInTheDocument();
    await screen.findByRole('option', { name: 'production' });
    expect(useUiStore.getState().environmentId).toBe('production');
  });
});
