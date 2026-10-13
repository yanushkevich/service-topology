import { describe, expect, it } from 'vitest';
import { mockTopology } from '../mock/topology';
import { definitionOf } from '../../transit/definition';
import { paymentServiceBoard } from '../../transit/mock/paymentServiceBoard';
import { BUNDLE_MODULES, bundleOf, countsOf, topologyOf, validateBundle } from './bundle';
import { bundleFileName, formatOfFileName, readBundle, serializeBundle } from './format';

const T = '2026-10-13T09:30:00Z';
const exampleBundle = () => bundleOf(mockTopology, [definitionOf(paymentServiceBoard('production'))], { exportedAt: T, source: { label: 'Mock inventory · local sandbox', isMock: true } });

describe('data bundle (ADR-032)', () => {
  it('holds every module, keys in file order, and the topology unchanged', () => {
    const bundle = exampleBundle();
    expect(Object.keys(bundle)).toEqual(['format', 'version', 'exportedAt', 'source', ...BUNDLE_MODULES.map((m) => m.key)]);
    expect(topologyOf(bundle)).toEqual(mockTopology);
    expect(countsOf(bundle)).toMatchObject({ serviceDefinitions: mockTopology.serviceDefinitions.length, businessFlows: mockTopology.businessFlows?.length, transitBoards: 1 });
    expect(validateBundle(bundle)).toEqual([]);
  });

  it.each(['json', 'yaml'] as const)('round-trips through %s exactly', (format) => {
    const bundle = exampleBundle();
    const text = serializeBundle(bundle, format);
    const read = readBundle(text, format);
    expect(read).toEqual({ ok: true, bundle });
    if (format === 'yaml') expect(text).toMatch(/^format: service-topology\.bundle\nversion: 1\n/);
  });

  it('reads a JSON file as YAML too (JSON is YAML)', () => {
    expect(readBundle(serializeBundle(exampleBundle(), 'json'), 'yaml').ok).toBe(true);
  });

  it('reports unreadable files and wrong field types as issues, never throws', () => {
    expect(readBundle('{ nope', 'json')).toMatchObject({ ok: false, issues: [{ code: 'bundle-unreadable' }] });
    expect(readBundle('a: [1,\n', 'yaml')).toMatchObject({ ok: false, issues: [{ code: 'bundle-unreadable' }] });
    expect(readBundle('- just\n- a list\n', 'yaml')).toMatchObject({ ok: false, issues: [{ code: 'bundle-unreadable' }] });
    const bundle = exampleBundle() as unknown as { transitBoards: { stations: unknown[] }[] };
    bundle.transitBoards[0]!.stations[0] = { id: 42, name: 7, kind: 'caller' };
    const read = readBundle(JSON.stringify(bundle), 'json');
    expect(read.ok).toBe(false);
  });

  it('names files after the source and date', () => {
    expect(bundleFileName('Mock inventory · local sandbox', T, 'yaml')).toBe('service-topology-mock-inventory-local-sandbox-2026-10-13.yaml');
    expect(formatOfFileName('Data.YML')).toBe('yaml');
    expect(formatOfFileName('data.json')).toBe('json');
    expect(formatOfFileName('data.txt')).toBeNull();
  });
});
