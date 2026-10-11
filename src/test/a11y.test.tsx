import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { useSimulationStore } from '../state/simulationStore';
import { useUiStore } from '../state/uiStore';
import { renderApp, resetUiStore } from './renderApp';

/**
 * Automated accessibility audit (axe-core, WCAG 2.0–2.2 A/AA rules) of every page and key state.
 * jsdom has no layout, so `color-contrast` is checked separately (src/styles/contrast.test.ts and
 * the real-browser audit, scripts/audit-a11y.mjs).
 */
async function audit(): Promise<string[]> {
  const result = await axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
    rules: { 'color-contrast': { enabled: false } },
  });
  return result.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`,
  );
}

describe('accessibility audit (axe-core)', () => {
  beforeEach(resetUiStore);

  it('service map (2D) with a selection', async () => {
    useUiStore.setState({ selection: { kind: 'service-instance', id: 'payment-service.production' } });
    renderApp('/map');
    await screen.findByLabelText(/^Payment Service, api/);
    expect(await audit()).toEqual([]);
  });

  it('service map, grouped infrastructure mode with filters and layouts panels open', async () => {
    const user = userEvent.setup();
    useUiStore.setState({ layoutMode: 'infrastructure' });
    renderApp('/map');
    await screen.findByRole('button', { name: 'Collapse eks-commerce-prod' });
    await user.click(screen.getByRole('button', { name: 'Filters' }));
    await user.click(screen.getByRole('button', { name: 'Layouts' }));
    await user.click(screen.getByRole('button', { name: 'Groups' }));
    expect(await audit()).toEqual([]);
  });

  it('3D view (WebGL fallback in jsdom)', async () => {
    useUiStore.setState({ activeView: '3d' });
    renderApp('/map');
    await screen.findByRole('heading', { name: '3D needs WebGL' });
    expect(await audit()).toEqual([]);
  });

  it('registry with selection, filters, and inspector', async () => {
    const user = userEvent.setup();
    renderApp('/registry');
    const table = await screen.findByRole('table');
    await user.click(within(table).getByRole('button', { name: /Order Service\s*order-service\.production/ }));
    await user.click(within(screen.getByRole('group', { name: 'Health' })).getByRole('button', { name: /Degraded/ }));
    expect(await audit()).toEqual([]);
  });

  it('registry no-results state', async () => {
    useUiStore.setState({ filters: { query: 'zzz', providers: [], health: [], groups: [] } });
    renderApp('/registry');
    await screen.findByText('No matches');
    expect(await audit()).toEqual([]);
  });

  it('events & traffic with a simulated failure and history comparison', async () => {
    const user = userEvent.setup();
    renderApp('/events');
    await screen.findByRole('list', { name: 'Snapshots' });
    act(() => useSimulationStore.getState().inject('payment-service.production', 'unavailable'));
    await user.click(screen.getByRole('button', { name: 'Compare' }));
    await screen.findByRole('list', { name: 'Differences' });
    expect(await audit()).toEqual([]);
  });

  it('history mode banner', async () => {
    renderApp('/registry?v=1&env=production&asof=fixture-0600');
    await screen.findByText(/Viewing history:/);
    expect(await audit()).toEqual([]);
  });

  it.each([
    ['/overview', 'Needs attention'],
    ['/dependencies?v=1&env=production&sel=service-instance:order-service.production', /^Upstream/],
    ['/infrastructure', 'Containment'],
    ['/settings', 'Appearance'],
  ])('section page %s', async (path, section) => {
    renderApp(path);
    await screen.findByRole('heading', { level: 2, name: section });
    expect(await audit()).toEqual([]);
  });

  it('not found page', async () => {
    renderApp('/nope');
    await screen.findByRole('heading', { level: 1 });
    expect(await audit()).toEqual([]);
  });
});
