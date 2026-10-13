import type { BusinessFlow } from '../../domain/types';

/**
 * Synthetic business flows for the scale target (docs/BUSINESS_FLOWS.md §7: 50 flows, 40 steps per
 * flow): deterministic, over `services` generated service IDs, with a decision and an undo path in
 * each flow. Used by tests and `npm run bench`; layout only (not validated against a topology).
 */
export function generateFlows({ flows = 50, steps = 40, services = 30 } = {}): BusinessFlow[] {
  return Array.from({ length: flows }, (_, f) => {
    const step = (i: number) => ({
      id: `s${i}`,
      name: `Flow ${f} step ${i}`,
      serviceDefinitionId: `svc-${(f * 7 + i * 3) % services}`,
      kind: i === 10 ? ('decision' as const) : i === steps - 1 ? ('compensation' as const) : ('task' as const),
      ...(i % 5 === 0 ? { entryPoint: `Op${(f + i) % 20}` } : {}),
    });
    const all = Array.from({ length: steps }, (_, i) => step(i));
    const transitions: BusinessFlow['transitions'] = all.slice(0, -2).map((s, i) => ({
      id: `t${i}`,
      from: s.id,
      to: `s${i + 1}`,
      via: { kind: 'call' as const },
      ...(i === 10 ? { condition: 'approved' } : {}),
      policies: i % 3 === 0 ? [{ type: 'timeout' as const, label: '2 s', state: 'exercised' as const, config: { timeoutMs: '2000' } }, { type: 'retry' as const, label: 'retry ×2', state: 'idle' as const }] : [],
    }));
    transitions.push({ id: 'declined', from: 's10', to: `s${steps - 1}`, via: { kind: 'call' }, condition: 'declined', policies: [] });
    transitions.push({ id: 'end', from: `s${steps - 2}`, to: 'done', via: { kind: 'local' }, policies: [] });
    transitions.push({ id: 'undone', from: `s${steps - 1}`, to: 'cancelled', via: { kind: 'local' }, policies: [] });
    return {
      id: `flow-${f}`,
      name: `Flow ${String(f).padStart(2, '0')}`,
      trigger: { kind: 'manual' },
      startStepId: 's0',
      steps: all,
      transitions,
      outcomes: [
        { id: 'done', name: 'Done', kind: 'success' },
        { id: 'cancelled', name: 'Cancelled', kind: 'cancelled' },
      ],
      source: { kind: 'authored' },
    };
  });
}
