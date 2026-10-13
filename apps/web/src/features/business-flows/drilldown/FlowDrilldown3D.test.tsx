import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderApp, resetUiStore } from '../../../test/renderApp';

/**
 * Navigation of the 3D drill-down (ADR-026). jsdom has no WebGL: the canvas is stubbed and WebGL
 * reported present, so the overlay, the URL, and the keyboard path are tested; the scene itself is
 * tested with the R3F test renderer (DrilldownScene.test.tsx).
 */
vi.mock('../../service-map/galaxy/webgl', () => ({ detectWebGL: () => true, watchContextLoss: () => () => undefined }));
vi.mock('@react-three/fiber', async (importOriginal) => ({ ...(await importOriginal<typeof import('@react-three/fiber')>()), Canvas: () => null }));

const params = (router: ReturnType<typeof renderApp>) => new URLSearchParams(router.state.location.search);

describe('3D drill-down navigation', () => {
  beforeEach(resetUiStore);

  it('opens from the board, enters a service, and climbs back, keeping the selected step', async () => {
    const user = userEvent.setup();
    const router = renderApp('/flows/flow-checkout?v=1&env=production&step=capture-payment');
    await user.click(await screen.findByRole('button', { name: '3D' }));
    expect(params(router).get('scene')).toBe('3d');
    const services = await screen.findByRole('region', { name: 'Services in this flow' });

    await user.click(within(services).getByRole('button', { name: 'Enter Payment Service' }));
    expect(params(router).get('drill')).toBe('payment-service');
    expect(params(router).get('step')).toBe('capture-payment');
    const scope = screen.getByRole('navigation', { name: '3D scope' });
    expect(within(scope).getByText('Payment Service')).toHaveAttribute('aria-current', 'true');

    // Escape climbs back before it would clear the step.
    screen.getByRole('region', { name: '3D drill-down of Checkout' }).focus();
    await user.keyboard('{Escape}');
    expect(params(router).get('drill')).toBeNull();
    expect(params(router).get('step')).toBe('capture-payment');
    expect(params(router).get('scene')).toBe('3d');
  });

  it('enters and leaves with the browser history too, and returns to the swimlane', async () => {
    const user = userEvent.setup();
    const router = renderApp('/flows/flow-checkout?v=1&env=production&scene=3d');
    const services = await screen.findByRole('region', { name: 'Services in this flow' });
    await user.click(within(services).getByRole('button', { name: /^Enter Inventory Service/ }));
    expect(params(router).get('drill')).toBe('inventory-service');
    await act(() => router.navigate(-1));
    await waitFor(() => expect(params(router).get('drill')).toBeNull());

    await user.click(screen.getByRole('button', { name: 'Back to the swimlane' }));
    expect(params(router).get('scene')).toBeNull();
    expect(await screen.findByRole('button', { name: 'Swimlane' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('says which services have no transit board yet', async () => {
    renderApp('/flows/flow-checkout?v=1&env=production&scene=3d');
    const services = await screen.findByRole('region', { name: 'Services in this flow' });
    expect(within(services).getByRole('button', { name: 'Enter Payment Service' })).toBeInTheDocument();
    expect(within(services).getByRole('button', { name: /^Enter Inventory Service.*no board yet$/ })).toBeInTheDocument();
  });
});
