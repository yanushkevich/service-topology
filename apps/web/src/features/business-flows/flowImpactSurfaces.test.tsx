import { act, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useSimulationStore } from '../../state/simulationStore';
import { renderApp, resetUiStore } from '../../test/renderApp';

/** Milestone 12 (ADR-025): simulated failures on business flows, on every surface, labelled simulated. */

async function failCardProcessor() {
  await waitFor(() => expect(useSimulationStore.getState().sim).not.toBeNull());
  act(() => useSimulationStore.getState().inject('ext-card-processor', 'unavailable'));
}

describe('flows in impact analysis', () => {
  beforeEach(resetUiStore);

  it('the simulation page lists the affected flows, where they stop, and how they likely end', async () => {
    renderApp('/simulation?v=1&env=production');
    await failCardProcessor();
    const list = await screen.findByRole('list', { name: 'Business flows affected' });
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Checkout stops at Authorize payment, likely Cancelled, with compensation. Cause: Card Processor API unavailable.',
      'Refund stops at Refund payment, likely Rejected. Cause: Card Processor API unavailable.',
    ]);
    const panel = screen.getByRole('region', { name: /Business flows affected/ });
    expect(within(panel).getByText('Simulated')).toBeInTheDocument();
  });

  it('the flow board shows a simulated banner and marks the affected steps', async () => {
    renderApp('/flows/flow-checkout?v=1&env=production');
    await failCardProcessor();
    const banner = await screen.findByRole('region', { name: 'Simulated impact on this flow' });
    expect(banner).toHaveTextContent('Simulated');
    expect(banner).toHaveTextContent('Card Processor API unavailable → Checkout stops at Authorize payment, likely Cancelled, with compensation.');
    expect(banner).toHaveTextContent('Authorize payment: degraded (Card Processor API → Payment Service)');
    await waitFor(() => expect(document.querySelector('[data-step="authorize-payment"]')).toHaveAttribute('data-simulated', 'degraded'));
    expect(document.querySelector('[data-step="place-order"]')).not.toHaveAttribute('data-simulated');
  });

  it('the catalog adds each flow’s simulated impact while failures are simulated', async () => {
    renderApp('/flows?v=1&env=production');
    await screen.findByRole('list', { name: 'Business flows' });
    expect(document.querySelector('[data-flow-impact-summary]')).toBeNull();
    await failCardProcessor();
    await waitFor(() => expect(document.querySelector('[data-flow-impact-summary="flow-checkout"]')).toHaveTextContent('stops at Authorize payment, likely Cancelled, with compensation'));
    expect(screen.getAllByText('Simulated impact')).toHaveLength(2);
  });

  it('the inspector lists the flows whose impact runs through the selected entity', async () => {
    renderApp('/registry?v=1&env=production&sel=service-instance:payment-service.production');
    await failCardProcessor();
    const inspector = await screen.findByRole('complementary', { name: 'Inspector' });
    const list = await within(inspector).findByRole('list', { name: 'Business flows affected' });
    expect(within(list).getAllByRole('link').map((a) => a.textContent)).toEqual(['Checkout', 'Refund']);
    // Inside the inspector's simulated section.
    expect(within(inspector).getByRole('region', { name: 'Simulation' })).toContainElement(list);
  });

  it('never calls simulated flow impact live', async () => {
    renderApp('/flows/flow-checkout?v=1&env=production');
    await failCardProcessor();
    const banner = await screen.findByRole('region', { name: 'Simulated impact on this flow' });
    expect(banner.textContent).not.toMatch(/\blive\b/i);
  });
});
