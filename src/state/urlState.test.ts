import { describe, expect, it } from 'vitest';
import { EMPTY_FILTERS } from '../domain/registry';
import { decodeUrlState, DEFAULT_URL_STATE, encodeUrlState, type TopologyUrlState } from './urlState';

const full: TopologyUrlState = {
  environmentId: 'staging',
  activeView: '3d',
  layoutMode: 'infrastructure',
  selection: { kind: 'relationship', id: 'rel:order-service.staging->topic-orders-events-staging' },
  filters: { query: 'pay ments', providers: ['gcp', 'aws'], health: ['degraded'], groups: ['messaging', 'data'] },
  highlightMode: 'upstream',
  neighborhood: { centerId: 'ledger-service.production', depth: 2 },
  asOf: 'fixture-0600',
};

describe('URL state codec', () => {
  it('round-trips every supported field', () => {
    const decoded = decodeUrlState(encodeUrlState(full));
    expect(decoded.present).toBe(true);
    expect(decoded.issues).toEqual([]);
    expect(decoded.state).toEqual({
      ...full,
      filters: { ...full.filters, providers: ['aws', 'gcp'], groups: ['data', 'messaging'] },
    });
  });

  it('omits defaults and keeps the version', () => {
    expect(encodeUrlState({ ...DEFAULT_URL_STATE, environmentId: 'production' })).toBe('v=1&env=production');
  });

  it('is canonical: equal state gives an identical string regardless of list order', () => {
    const a = encodeUrlState({ ...DEFAULT_URL_STATE, filters: { ...EMPTY_FILTERS, providers: ['gcp', 'aws'] } });
    const b = encodeUrlState({ ...DEFAULT_URL_STATE, filters: { ...EMPTY_FILTERS, providers: ['aws', 'gcp'] } });
    expect(a).toBe(b);
  });

  it('keeps IDs containing separators intact', () => {
    const { state } = decodeUrlState(encodeUrlState(full));
    expect(state.selection?.id).toBe('rel:order-service.staging->topic-orders-events-staging');
    const tricky = decodeUrlState('v=1&nh=' + encodeURIComponent('weird~id~3'));
    expect(tricky.state.neighborhood).toEqual({ centerId: 'weird~id', depth: 3 });
  });

  it('reports no state when the version parameter is absent', () => {
    expect(decodeUrlState('')).toMatchObject({ present: false, state: DEFAULT_URL_STATE });
    expect(decodeUrlState('?foo=bar').present).toBe(false);
  });

  it('ignores everything for an unsupported version', () => {
    const decoded = decodeUrlState('v=99&view=3d');
    expect(decoded).toMatchObject({ present: false, state: DEFAULT_URL_STATE });
    expect(decoded.issues).toEqual(['Unsupported URL state version "99"']);
  });

  it('drops malformed values without throwing', () => {
    const decoded = decodeUrlState('v=1&view=4d&layout=x&sel=nonsense&hl=sideways&provider=aws,mars&health=ok&nh=a~9');
    expect(decoded.state).toMatchObject({
      activeView: '2d',
      layoutMode: 'topology',
      selection: null,
      highlightMode: 'direct',
      neighborhood: { centerId: 'a', depth: 1 },
    });
    expect(decoded.state.filters.providers).toEqual(['aws']);
    expect(decoded.state.filters.health).toEqual([]);
    expect(decoded.issues.length).toBe(7);
  });

  it('rejects a selection with an unknown kind but passes unknown IDs through', () => {
    expect(decodeUrlState('v=1&sel=planet:earth').state.selection).toBeNull();
    expect(decodeUrlState('v=1&sel=service-instance:ghost').state.selection).toEqual({ kind: 'service-instance', id: 'ghost' });
  });
});
