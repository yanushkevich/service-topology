import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from '../state/uiStore';
import { usePreferencesStore } from '../state/preferencesStore';
import { renderApp as renderAt, resetUiStore } from '../test/renderApp';
import { NAV_ITEMS } from './navigation';

/** Nav names contain the full label (e.g. "Deps (Dependencies)"). */
const navName = (label: string) => new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

describe('application shell', () => {
  beforeEach(resetUiStore);

  it('redirects the root to the Service Map with canvas and inspector regions', async () => {
    const router = renderAt('/');
    expect(await screen.findByRole('region', { name: 'Topology canvas' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Inspector' })).toHaveTextContent('Nothing selected');
    expect(router.state.location.pathname).toBe('/map');
  });

  it('renders every navigation section without a broken page', async () => {
    const user = userEvent.setup();
    renderAt('/map');
    const nav = await screen.findByRole('navigation', { name: 'Sections' });
    for (const item of NAV_ITEMS) {
      await user.click(within(nav).getByRole('link', { name: navName(item.label) }));
      expect(within(nav).getByRole('link', { name: navName(item.label) })).toHaveAttribute('aria-current', 'page');
      expect(screen.getByRole('heading', { level: 1, name: item.label })).toBeInTheDocument();
    }
  });

  it('shows a not-found page for unknown routes', async () => {
    renderAt('/does-not-exist');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('switches between the 2D map, its grouped mode, and 3D (WebGL fallback in jsdom)', async () => {
    const user = userEvent.setup();
    useUiStore.setState({ selection: { kind: 'service-instance', id: 'order-service.production' } });
    renderAt('/map');
    const view = await screen.findByRole('group', { name: 'View' });
    expect(await screen.findByLabelText(/^Order Service, api/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Grouped infrastructure' }));
    expect(await screen.findByRole('button', { name: 'Collapse eks-commerce-prod' })).toBeInTheDocument();

    await user.click(within(view).getByRole('button', { name: '3D Galaxy' }));
    expect(within(view).getByRole('button', { name: '3D Galaxy' })).toHaveAttribute('aria-pressed', 'true');
    // jsdom has no WebGL: the 3D view must fail gracefully and offer the 2D map and registry.
    expect(await screen.findByRole('heading', { name: '3D needs WebGL' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the registry' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Layout mode' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open the 2D map' }));
    expect(useUiStore.getState()).toMatchObject({ activeView: '2d', selection: { id: 'order-service.production' } });
    expect(await screen.findByLabelText(/^Order Service, api/)).toBeInTheDocument();
    // Two real ELK layouts plus the 3D fallback: ~1–2 s alone, but it can pass 5 s under full-suite load.
  }, 15_000);

  it('preserves the active view across route changes', async () => {
    const user = userEvent.setup();
    renderAt('/map');
    await user.click(await screen.findByRole('button', { name: '3D Galaxy' }));
    await user.click(screen.getByRole('link', { name: 'Service Registry' }));
    await user.click(screen.getByRole('link', { name: 'Service Map' }));
    expect(screen.getByRole('button', { name: '3D Galaxy' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('toggles the theme on the document and saves it as an explicit preference', async () => {
    const user = userEvent.setup();
    renderAt('/map');
    await user.click(await screen.findByRole('button', { name: 'Switch to light theme' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(usePreferencesStore.getState().preferences.theme).toBe('light');
    await user.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('updates the shared environment from the header selector', async () => {
    const user = userEvent.setup();
    renderAt('/map');
    await screen.findByRole('option', { name: 'staging' });
    expect(within(screen.getByLabelText('Environment')).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'production',
      'staging',
      'development',
    ]);
    await user.selectOptions(screen.getByLabelText('Environment'), 'staging');
    expect(useUiStore.getState().environmentId).toBe('staging');
  });
});
