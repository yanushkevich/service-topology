import type { Line, LineGroup, PolicyStop, Station, TransitBoard } from '../types';

/**
 * Synthetic board for the spec's scale target (60 lines, 80 stations): deterministic, example data.
 * Used by tests and `npm run bench`; never shown as a real service.
 */
export function generateBoard({ lines: lineCount = 60, stations: stationCount = 80 } = {}): TransitBoard {
  const kinds = { caller: 6, gate: 4, module: 0, client: 0, dependency: 0 };
  const rest = stationCount - kinds.caller - kinds.gate;
  kinds.module = Math.round(rest * 0.4);
  kinds.client = Math.floor((rest - kinds.module) / 2);
  kinds.dependency = rest - kinds.module - kinds.client;
  const stations: Station[] = [];
  for (const [kind, n] of Object.entries(kinds) as [Station['kind'], number][]) {
    for (let i = 0; i < n; i++) stations.push({ id: `${kind}:${i}`, name: `${kind} ${i}`, kind, provenance: { kind: 'observed', detail: 'generated' } });
  }
  const pick = (kind: Station['kind'], seed: number) => `${kind}:${seed % kinds[kind]}`;
  const policies: PolicyStop[] = [];
  for (let c = 0; c < kinds.client; c++) {
    (['timeout', 'retry', 'breaker'] as const).forEach((type, order) =>
      policies.push({ id: `pol:${c}:${order}`, clientId: `client:${c}`, order, type, state: 'exercised', label: type, provenance: { kind: 'declared', detail: 'generated' }, ...(type === 'timeout' ? { config: { timeoutMs: '500' } } : {}) }),
    );
  }
  const groups: LineGroup[] = ['grpc', 'http', 'webhook', 'event', 'scheduled', 'background'];
  const lines: Line[] = Array.from({ length: lineCount }, (_, i) => {
    const module = pick('module', i * 7);
    const a = (i * 5) % kinds.client;
    const b = (i * 11 + 3) % kinds.client;
    return {
      id: `L${i}`,
      code: `L${i}`,
      name: `endpoint ${i}`,
      group: groups[i % groups.length] ?? 'grpc',
      signature: `rpc Endpoint${i}()`,
      caller: `caller ${i % kinds.caller}`,
      deadlineMs: 2000,
      stats: { p50Ms: 10, p95Ms: 40, errorRate: 0.001, callsPerDay: 1000, traces: 100 },
      route: [
        { stations: [pick('caller', i), pick('gate', i), module, `client:${a}`, `dependency:${a % kinds.dependency}`], kind: 'sequential' },
        { stations: [module, `client:${b}`, `dependency:${b % kinds.dependency}`], kind: 'sequential' },
      ],
      patterns: [],
      findings: [],
      provenance: { entry: { kind: 'declared', detail: 'generated' }, route: { kind: 'observed', detail: 'generated' } },
    };
  });
  return { serviceDefinitionId: 'generated', environmentId: 'production', window: '24h', isExample: true, sources: [], stations, policies, lines };
}
