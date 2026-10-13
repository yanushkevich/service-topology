import ELK from 'elkjs/lib/elk.bundled.js';
import { describe, expect, it } from 'vitest';
import { generateTopology, INVENTORY_1000, SCALE_250 } from '../../../data/mock/generateTopology';
import { EMPTY_FILTERS } from '../../../domain/registry';
import { buildTopologyIndex } from '../../../domain/topologyIndex';
import { toLayoutRequest } from '../graph/layoutRequest';
import { buildTopologyGraph } from '../graph/topologyGraph';
import { createElkLayoutService } from './elkLayoutService';
import { indexBoard } from '../../../transit/board';
import { computeMapGeometry } from '../../../transit/layout';
import { generateBoard } from '../../../transit/mock/generateBoard';
import { computeFlowGeometry, indexFlows } from '../../../transit/flows/flowLayout';
import { generateFlows } from '../../../transit/flows/generateFlows';

/**
 * Timing benchmark (ADR-005). Skipped in normal runs; `npm run bench` enables it and prints
 * median/p95 per case. Node + bundled ELK on one thread; the browser runs ELK in a worker
 * (see scripts/bench-browser.mjs for in-browser numbers).
 */
const enabled = Boolean(import.meta.env.VITE_PERF);

async function time(fn: () => unknown, iterations: number, warmup = 2) {
  for (let i = 0; i < warmup; i++) await fn();
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const at = (q: number) => samples[Math.min(samples.length - 1, Math.floor(q * samples.length))] ?? 0;
  return { median: at(0.5), p95: at(0.95), min: samples[0] ?? 0, max: samples.at(-1) ?? 0, n: iterations };
}

describe.runIf(enabled)('performance benchmarks', () => {
  it('measures layout and graph building', async () => {
    const elk = createElkLayoutService(new ELK());
    const scale = buildTopologyIndex(generateTopology(SCALE_250));
    const inventory = buildTopologyIndex(generateTopology(INVENTORY_1000));
    const prod = { environmentId: 'production', filters: EMPTY_FILTERS } as const;
    const topology = toLayoutRequest(buildTopologyGraph(scale, { ...prod, mode: 'topology' }));
    const grouped = toLayoutRequest(buildTopologyGraph(scale, { ...prod, mode: 'infrastructure' }));
    expect(topology.nodes).toHaveLength(250);
    expect(topology.edges).toHaveLength(750);
    const transitTarget = generateBoard({ lines: 60, stations: 80 });
    const flowTarget = generateFlows({ flows: 50, steps: 40 });
    const flowIndex = indexFlows(flowTarget, (id) => id);
    const transitIndex = indexBoard(transitTarget);
    expect(transitTarget.stations).toHaveLength(80);
    const providers = new Set(['provider:aws', 'provider:azure', 'provider:gcp', 'provider:on-prem', 'provider:saas']);

    const results = {
      'ELK layout 250/750, topology': await time(() => elk.layout(topology), 10),
      'ELK layout 250/750, infrastructure (nested groups)': await time(() => elk.layout(grouped), 10),
      'Graph model 250/750 (no layout)': await time(() => buildTopologyGraph(scale, { ...prod, mode: 'topology' }), 50),
      'Search filter over 1,000-entity inventory': await time(
        () => buildTopologyGraph(inventory, { ...prod, mode: 'topology', filters: { ...EMPTY_FILTERS, query: 'payments' } }),
        50,
      ),
      'Transit board 60 lines / 80 stations: index + map geometry (perspective)': await time(() => computeMapGeometry(indexBoard(transitTarget), { flat: false }), 50),
      'Transit board 60 lines / 80 stations: map geometry (flat)': await time(() => computeMapGeometry(transitIndex, { flat: true }), 50),
      'Business flows 50 flows × 40 steps: index + flow geometry (perspective)': await time(() => computeFlowGeometry(indexFlows(flowTarget, (id) => id), { flat: false }), 20),
      'Business flows 50 flows × 40 steps: flow geometry (flat)': await time(() => computeFlowGeometry(flowIndex, { flat: true }), 20),
      '1,000 inventory grouped + collapsed to providers': await time(
        () => buildTopologyGraph(inventory, { ...prod, mode: 'infrastructure', collapsedGroupIds: providers }),
        50,
      ),
    };
    const rows = Object.entries(results).map(([name, r]) => ({
      case: name,
      'median ms': r.median.toFixed(1),
      'p95 ms': r.p95.toFixed(1),
      'min ms': r.min.toFixed(1),
      'max ms': r.max.toFixed(1),
      runs: r.n,
    }));
    console.table(rows);
  }, 300_000);
});
