import { ApiError } from '../data/http/apiClient';
import type { IntegrationStatus, SourceCheck, SourceIntegration, SyncPreview } from '../data/integrations/sourceIntegration';
import type { TopologyRepository } from '../data/repositories/TopologyRepository';
import { createWritableRepository } from './writableRepository';

/**
 * Test double for the backend's Dynatrace connector (ADR-034): a configurable status, check,
 * preview, and alias list, recording what was applied and saved. Shapes follow docs/api/openapi.json.
 */

export const connectedStatus: IntegrationStatus = {
  source: 'dynatrace',
  isExample: false,
  tenants: [{ id: 'main', host: 'abc12345.apps.dynatrace.com', auth: 'oauth', isExample: false }],
  environments: [
    { id: 'production', name: 'Production', kind: 'production', tenant: 'main', match: 'tag environment = production' },
    { id: 'staging', name: 'Staging', kind: 'staging', tenant: 'main', match: 'tag environment = staging' },
  ],
  refreshIntervalSeconds: 60,
  lastSync: null,
  lastRefresh: { at: '2026-10-15T08:46:00Z', ok: true, entities: 12 },
  observations: { source: 'dynatrace', observedAt: '2026-10-15T08:46:00Z', isExample: false, entities: 12, stale: false, refreshIntervalSeconds: 60 },
  aliasCount: 0,
};

export const readyPreview: SyncPreview = {
  id: 'preview-1',
  source: 'dynatrace',
  baseRevision: 'rev-1',
  createdAt: '2026-10-15T08:45:00Z',
  expiresAt: '2026-10-15T08:55:00Z',
  discoveredAt: '2026-10-15T08:45:00Z',
  isExample: false,
  summary: { 'service-definition': { create: 1, link: 1 }, 'service-instance': { create: 1, keep: 1 }, relationship: { create: 1 } },
  changes: [
    { op: 'create', kind: 'service-definition', id: 'checkout-service', name: 'checkout-service' },
    { op: 'link', kind: 'service-definition', id: 'payment-service', name: 'Payment Service' },
    { op: 'create', kind: 'service-instance', id: 'checkout-service.production', name: 'checkout-service.production' },
    { op: 'keep', kind: 'service-instance', id: 'ledger-service.production', name: 'ledger-service.production', usedBy: ['flow-checkout'] },
    { op: 'create', kind: 'relationship', id: 'rel:checkout-service.production->payment-service.production', name: 'rel:checkout-service.production->payment-service.production' },
  ],
  notes: [{ code: 'cross-environment-call', message: '1 call crosses environments and was dropped.', ids: ['SERVICE-1 → SERVICE-2'] }],
  issues: [],
  canApply: true,
};

const checks: SourceCheck[] = [
  { tenant: 'main', query: 'services', ok: true, records: 214, scannedBytes: 0, durationMs: 410 },
  { tenant: 'main', query: 'service-calls', ok: true, records: 380, missingFields: ['target_type'], scannedBytes: 0, durationMs: 380 },
  { tenant: 'main', query: 'problems', ok: false, records: 0, missingScopes: ['storage:events:read'], scannedBytes: 0, durationMs: 90, message: 'Missing scopes: storage:events:read' },
];

export function createFakeIntegration(options: { status?: IntegrationStatus | null; preview?: SyncPreview; applyError?: ApiError } = {}) {
  const calls = { applied: [] as string[], saved: [] as Record<string, string>[] };
  let aliases: Record<string, string> = {};
  let revision = 0;
  const integration: SourceIntegration = {
    status: async () => (options.status === undefined ? connectedStatus : options.status),
    check: async () => checks,
    preview: async () => options.preview ?? readyPreview,
    async apply(preview) {
      if (options.applyError) throw options.applyError;
      calls.applied.push(preview.id);
      return 'rev-2';
    },
    aliases: async () => ({ aliases, revision: `"${revision}"` }),
    async saveAliases(next, ifMatch) {
      if (ifMatch !== `"${revision}"`) throw new ApiError(412, 'Precondition failed', 'req-test');
      aliases = next;
      revision++;
      calls.saved.push(next);
      return { aliases, revision: `"${revision}"` };
    },
  };
  return { integration, calls };
}

/** A backend-like repository (writable mock data) with the fake connector. */
export function repositoryWithIntegration(integration: SourceIntegration): TopologyRepository {
  const { repository } = createWritableRepository();
  return { ...repository, integration };
}
