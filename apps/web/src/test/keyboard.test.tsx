import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useSimulationStore } from '../state/simulationStore';
import { useUiStore } from '../state/uiStore';
import { renderApp, resetUiStore } from './renderApp';

describe('keyboard access', () => {
  beforeEach(resetUiStore);

  it('starts with a skip link that moves focus to the main content', async () => {
    const user = userEvent.setup();
    renderApp('/registry');
    await screen.findByRole('table');
    await user.tab();
    const skip = screen.getByRole('link', { name: 'Skip to main content' });
    expect(skip).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(document.activeElement?.id).toBe('main-content'));
  });

  it('reaches header controls and section navigation in order, and operates them', async () => {
    const user = userEvent.setup();
    const router = renderApp('/registry');
    await screen.findByRole('table');
    await user.tab(); // skip link
    await user.tab();
    expect(screen.getByLabelText('Environment')).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('searchbox', { name: 'Search services and resources' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'New' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('link', { name: /Simulated\s*.*simulation paused/ })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: /Switch to (light|dark) theme/ })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(useUiStore.getState().theme).toBe('light');
    await user.tab();
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(router.state.location.pathname).toBe('/overview');
  });

  it('selects a registry row with Enter and updates the inspector', async () => {
    const user = userEvent.setup();
    renderApp('/registry');
    const table = await screen.findByRole('table');
    const row = within(table).getByRole('button', { name: /Ledger Service\s*ledger-service\.production/ });
    row.focus();
    await user.keyboard('{Enter}');
    expect(useUiStore.getState().selection).toEqual({ kind: 'service-instance', id: 'ledger-service.production' });
    expect(within(screen.getByRole('complementary', { name: 'Inspector' })).getByRole('heading', { name: 'Ledger Service' })).toBeInTheDocument();
  });

  it('focuses and selects a 2D map node with the keyboard', async () => {
    const user = userEvent.setup();
    renderApp('/map');
    const node = await screen.findByLabelText(/^Fraud Scoring, api/);
    expect(node).toHaveAttribute('tabindex', '0');
    node.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(useUiStore.getState().selection).toEqual({ kind: 'service-instance', id: 'fraud-scoring.production' }));
  });

  it('injects a simulated failure using only the keyboard', async () => {
    const user = userEvent.setup();
    renderApp('/simulation');
    const target = await screen.findByLabelText('Fail');
    target.focus();
    await user.selectOptions(target, 'ledger-service.production');
    await user.tab(); // failure mode radios
    await user.tab();
    await user.keyboard('{Enter}'); // "Degraded"
    const submit = screen.getByRole('button', { name: 'Inject failure' });
    submit.focus();
    await user.keyboard('{Enter}');
    expect(useSimulationStore.getState().sim?.failures).toEqual([{ entityId: 'ledger-service.production', mode: 'degraded', injectedTick: 0 }]);
  });

  it('titles each page by section', async () => {
    renderApp('/simulation');
    await waitFor(() => expect(document.title).toBe('Simulation · Service Topology'));
  });
});
