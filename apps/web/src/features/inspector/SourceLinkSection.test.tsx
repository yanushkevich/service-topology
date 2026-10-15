import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { act } from 'react';
import { mockTopology } from '../../data/mock/topology';
import type { TopologyRepository } from '../../data/repositories/TopologyRepository';
import type { TopologyData } from '../../domain/types';
import { useSimulationStore } from '../../state/simulationStore';
import { renderApp, resetUiStore } from '../../test/renderApp';

/** Dynatrace provenance in the inspector, and the refetch of observed data (ADR-034). */

const observedAt = '2026-10-15T08:46:00Z';

/** The mock topology with payment-service linked to Dynatrace and observed (problems and metrics). */
function linked(health: 'healthy' | 'degraded', problems: string[]): TopologyData {
  const data = structuredClone(mockTopology);
  data.serviceInstances = data.serviceInstances.map((i) =>
    i.id === 'payment-service.production'
      ? { ...i, health, metrics: { latencyMs: 210, throughputPerSecond: 20, errorRatePercent: 0.5, isSimulated: false, observedAt }, metadata: { dynatrace: { tenant: 'main', id: 'SERVICE-30E45F0274EFB653', observedAt, problems } } }
      : i,
  );
  data.serviceInstances = data.serviceInstances.map((i) =>
    i.id === 'ledger-service.production' ? { ...i, health: 'unknown', metadata: { dynatrace: { tenant: 'main', id: 'SERVICE-2', missingSince: '2026-10-15T08:45:00Z' } } } : i,
  );
  return data;
}

/** A repository whose data can change between loads, refetched every `refreshMs`. */
function refreshing(first: TopologyData, refreshMs: number | null) {
  let current = first;
  const repository: TopologyRepository = {
    sourceLabel: 'Backend API · mock inventory · observed by Dynatrace at 08:46',
    isMock: true,
    refreshMs,
    async getTopology() {
      return structuredClone(current);
    },
  };
  return { repository, set: (next: TopologyData) => (current = next) };
}

const telemetry = () => screen.findByRole('region', { name: 'Telemetry' });

describe('Dynatrace in the inspector', () => {
  beforeEach(resetUiStore);

  it('shows the link, the observation time, open problems, and observed metrics', async () => {
    renderApp('/registry?v=1&env=production&sel=service-instance:payment-service.production', refreshing(linked('degraded', ['P-24101501']), null).repository);
    const section = (await screen.findByRole('heading', { name: 'Dynatrace' })).closest('section') as HTMLElement;
    expect(within(section).getByText('SERVICE-30E45F0274EFB653')).toBeInTheDocument();
    expect(section).toHaveTextContent(/Health observed at .* · open problems: P-24101501/);
    expect(await telemetry()).toHaveTextContent('Observed');
    // The raw link is not repeated as metadata.
    expect(screen.queryByText('dynatrace')).not.toBeInTheDocument();
  });

  it('flags an entity Dynatrace no longer sees', async () => {
    renderApp('/registry?v=1&env=production&sel=service-instance:ledger-service.production', refreshing(linked('healthy', []), null).repository);
    const section = (await screen.findByRole('heading', { name: 'Dynatrace' })).closest('section') as HTMLElement;
    expect(section).toHaveTextContent(/Not seen in Dynatrace since .*\. Kept because something here still uses it\./);
  });
});

describe('refetching observed data', () => {
  beforeEach(resetUiStore);

  it('refreshes observed health without restarting a running simulation', async () => {
    const source = refreshing(linked('healthy', []), 40);
    renderApp('/registry?v=1&env=production&sel=service-instance:payment-service.production', source.repository);
    const section = (await screen.findByRole('heading', { name: 'Dynatrace' })).closest('section') as HTMLElement;
    expect(section).toHaveTextContent('no open problems');
    act(() => useSimulationStore.getState().inject('rds-orders-prod', 'unavailable'));
    source.set(linked('degraded', ['P-1']));
    await waitFor(() => expect(section).toHaveTextContent('open problems: P-1'), { timeout: 2000 });
    expect(useSimulationStore.getState().sim?.failures.map((f) => f.entityId)).toEqual(['rds-orders-prod']);
  });
});
