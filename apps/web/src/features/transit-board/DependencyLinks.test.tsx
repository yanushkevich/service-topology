import { waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockTopology } from '../../data/mock/topology';
import { createMockTopologyRepository } from '../../data/repositories/mockTopologyRepository';
import { renderApp, resetUiStore } from '../../test/renderApp';

const panel = (label: string) => {
  const element = document.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (!element) throw new Error(`No panel "${label}"`);
  return element;
};

describe('service-board dependencies are topology entities (ADR-027)', () => {
  beforeEach(resetUiStore);

  it('names the database as the topology does, shows its topology health, and links to it', async () => {
    const down = structuredClone(mockTopology);
    down.resources.find((r) => r.id === 'pg-payments-prod')!.health = 'unavailable';
    renderApp('/services/payment-service/transit?v=1&env=production&line=A2', createMockTopologyRepository(down));
    const card = await waitFor(() => panel('Line card'));
    const deps = await within(card).findByRole('region', { name: 'Depends on' });
    const pg = deps.querySelector('[data-dependency="dep:pg"]')!;
    expect(pg).toHaveAttribute('data-link', 'linked');
    expect(pg).toHaveTextContent(/payments-db.*In the topology: database · Unavailable/);
    expect(within(pg as HTMLElement).getByRole('link', { name: 'payments-db' })).toHaveAttribute('href', expect.stringContaining('sel=resource%3Apg-payments-prod'));
    // The stop strip reads the same health.
    expect(panel('Stop strip')).toHaveTextContent(/payments-db.*down/);
  });

  it('flags a dependency the topology does not have', async () => {
    renderApp('/services/payment-service/transit?v=1&env=production&line=A5');
    const card = await waitFor(() => panel('Line card'));
    const deps = await within(card).findByRole('region', { name: 'Depends on' });
    expect(deps.querySelector('[data-dependency="dep:redis"]')).toHaveTextContent('Not in the topology');
    expect(within(card).getByRole('region', { name: 'Findings' })).toHaveTextContent('Redis is not in the topology');
  });
});

describe('the database conversation on the service board (ADR-027)', () => {
  beforeEach(resetUiStore);

  it('shows what Capture writes at payments-db, in the strip and the card', async () => {
    renderApp('/services/payment-service/transit?v=1&env=production&line=A2');
    const card = await waitFor(() => panel('Line card'));
    const data = await within(card).findByRole('region', { name: 'Data' });
    expect(data.querySelector('[data-table="payment_outbox"]')).toHaveTextContent(/writes\s*payment_outbox\s*in payments-db\s*Transactional outbox/);
    expect(panel('Stop strip').querySelector('[data-tables]')).toHaveTextContent('writes payments · writes payment_outbox (transactional outbox)');
  });
});
