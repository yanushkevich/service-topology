import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from '../state/uiStore';
import { renderApp as renderAt, resetUiStore } from '../test/renderApp';
import { NAV_ITEMS } from './navigation';

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
      await user.click(within(nav).getByRole('link', { name: item.label }));
      expect(within(nav).getByRole('link', { name: item.label })).toHaveAttribute('aria-current', 'page');
      expect(screen.getByRole('heading', { level: 1, name: item.label })).toBeInTheDocument();
    }
  });

  it('shows a not-found page for unknown routes', async () => {
    renderAt('/does-not-exist');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('switches between the 2D map, its grouped mode, and the 3D placeholder', async () => {
    const user = userEvent.setup();
    renderAt('/map');
    const view = await screen.findByRole('group', { name: 'View' });
    expect(await screen.findByLabelText(/^Order Service, api/)).toBeInTheDocument();
    expect(screen.queryByTestId('view-placeholder')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Grouped infrastructure' }));
    expect(await screen.findByRole('button', { name: 'Collapse eks-commerce-prod' })).toBeInTheDocument();

    await user.click(within(view).getByRole('button', { name: '3D Galaxy' }));
    expect(within(view).getByRole('button', { name: '3D Galaxy' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('view-placeholder')).toHaveTextContent('3D Galaxy');
    expect(screen.queryByRole('group', { name: 'Layout mode' })).not.toBeInTheDocument();
  });

  it('preserves the active view across route changes', async () => {
    const user = userEvent.setup();
    renderAt('/map');
    await user.click(await screen.findByRole('button', { name: '3D Galaxy' }));
    await user.click(screen.getByRole('link', { name: 'Service Registry' }));
    await user.click(screen.getByRole('link', { name: 'Service Map' }));
    expect(screen.getByRole('button', { name: '3D Galaxy' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('toggles the theme on the document and persists it', async () => {
    const user = userEvent.setup();
    renderAt('/map');
    await user.click(await screen.findByRole('button', { name: 'Switch to light theme' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(window.localStorage.getItem('service-topology:theme')).toBe('light');
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
