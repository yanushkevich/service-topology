import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { useSimulationStore } from '../state/simulationStore';
import { useUiStore } from '../state/uiStore';
import { renderApp, resetUiStore } from './renderApp';
import { createWritableRepository } from './writableRepository';

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
    renderApp('/simulation');
    await screen.findByRole('list', { name: 'Snapshots' });
    act(() => useSimulationStore.getState().inject('payment-service.production', 'unavailable'));
    await user.click(screen.getByRole('button', { name: 'Compare' }));
    await screen.findByRole('list', { name: 'Differences' });
    expect(await audit()).toEqual([]);
  });

  it('transit board, no line selected', async () => {
    renderApp('/services/payment-service/transit');
    await screen.findByLabelText('Line card');
    expect(await audit()).toEqual([]);
  });

  it('transit board with a line selected, a finding focused, and the station chooser open', async () => {
    const user = userEvent.setup();
    renderApp('/services/payment-service/transit?v=1&env=production&line=A1');
    const card = await screen.findByLabelText('Line card');
    await user.click(within(card).getByRole('button', { name: /fraud client has no breaker/ }));
    const station = document.querySelector('[data-station="cli:card"]');
    if (station) fireEvent.click(station);
    await screen.findByRole('group', { name: 'Lines through card client' });
    expect(await audit()).toEqual([]);
  });

  it('transit board trace replay with a fan-out, and a tooltip open', async () => {
    renderApp('/services/payment-service/transit?v=1&env=production&line=J2&mode=trace');
    await screen.findByRole('list', { name: /^Steps of trace / });
    const station = document.querySelector('[data-station="dep:card"]');
    if (station) fireEvent.pointerEnter(station);
    await screen.findByRole('tooltip');
    expect(await audit()).toEqual([]);
  });

  it('business flows catalog', async () => {
    renderApp('/flows');
    await screen.findByRole('list', { name: 'Business flows' });
    expect(await audit()).toEqual([]);
  });

  it('flow board with a selected step, a focused finding, and a tooltip', async () => {
    const user = userEvent.setup();
    renderApp('/flows/flow-checkout?v=1&env=production&step=authorize-payment');
    const card = await screen.findByLabelText('Flow card');
    await user.click(within(card).getAllByRole('button', { pressed: false })[0]!);
    const station = document.querySelector('[data-station^="step:payment-service:Capture"]');
    if (station) fireEvent.pointerEnter(station);
    expect(await audit()).toEqual([]);
  });

  it('business-transaction replay', async () => {
    renderApp('/flows/flow-checkout?v=1&env=production&mode=replay&tx=order%204466');
    await screen.findByRole('list', { name: /^Steps of order / });
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
    ['/events/event-notification-requested', 'NotificationRequested'],
  ])('section page %s', async (path, section) => {
    renderApp(path);
    await screen.findByRole('heading', { level: 2, name: section });
    expect(await audit()).toEqual([]);
  });

  it('service map with an event-flow highlight', async () => {
    renderApp('/map?v=1&env=production&ev=event-order-placed');
    await screen.findByLabelText(/^Order Service, api/);
    await screen.findByText(/Event flow:/);
    expect(await audit()).toEqual([]);
  });

  it('not found page', async () => {
    renderApp('/nope');
    await screen.findByRole('heading', { level: 1 });
    expect(await audit()).toEqual([]);
  });
});

describe('accessibility audit: editing (ADR-020)', () => {
  beforeEach(resetUiStore);

  it('new-entity menu and editor sheet with field errors', async () => {
    const user = userEvent.setup();
    const { repository } = createWritableRepository();
    renderApp('/registry', repository);
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'New' }));
    expect(await audit()).toEqual([]);
    await user.click(screen.getByRole('menuitem', { name: /^Service instance/ }));
    const dialog = screen.getByRole('dialog', { name: 'New service instance' });
    await user.clear(within(dialog).getByRole('textbox', { name: /^ID/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(within(dialog).getByRole('textbox', { name: /^ID/ })).toHaveAttribute('aria-invalid', 'true');
    expect(await audit()).toEqual([]);
  });

  it('delete confirmation listing blockers', async () => {
    const user = userEvent.setup();
    const { repository } = createWritableRepository();
    useUiStore.setState({ selection: { kind: 'service-definition', id: 'payment-service' } });
    renderApp('/registry', repository);
    const inspector = await screen.findByRole('complementary', { name: 'Inspector' });
    await user.click(await within(inspector).findByRole('button', { name: 'Delete Payment Service' }));
    expect(screen.getByRole('dialog', { name: 'Delete service definition?' })).toBeInTheDocument();
    expect(await audit()).toEqual([]);
  });
});
