import { describe, expect, it } from 'vitest';
import { sourceLinkOf } from './sourceLink';

describe('sourceLinkOf', () => {
  it('reads the Dynatrace link, problems, and observation time', () => {
    expect(sourceLinkOf({ dynatrace: { tenant: 'main', id: 'SERVICE-1', observedAt: '2026-10-15T08:46:00Z', problems: ['P-1', 7] }, owner: 'x' })).toEqual({
      tenant: 'main', id: 'SERVICE-1', name: null, observedAt: '2026-10-15T08:46:00Z', problems: ['P-1'], missingSince: null, messaging: null, workload: null, fromSpans: false,
    });
  });

  it('is null without a link or with another shape', () => {
    expect(sourceLinkOf(undefined)).toBeNull();
    expect(sourceLinkOf({ owner: 'x' })).toBeNull();
    expect(sourceLinkOf({ dynatrace: 'SERVICE-1' })).toBeNull();
    expect(sourceLinkOf({ dynatrace: ['SERVICE-1'] })).toBeNull();
  });

  it('reads a channel\'s messaging system and destination (Milestone 15.1)', () => {
    expect(sourceLinkOf({ dynatrace: { tenant: 'main', system: 'kafka', destination: 'orders.events' } })?.messaging).toEqual({ system: 'kafka', destination: 'orders.events' });
  });

  it('reads the Kubernetes workload an instance runs as (ADR-008)', () => {
    expect(sourceLinkOf({ dynatrace: { id: 'SERVICE-1', workload: { id: 'K8S_DEPLOYMENT-1', name: 'payment', kind: 'Deployment' } } })?.workload).toEqual({ name: 'payment', kind: 'Deployment' });
    expect(sourceLinkOf({ dynatrace: { id: 'SERVICE-1', workload: 'payment' } })?.workload).toBeNull();
  });

  it('reads a call whose metrics come from spans, without showing its key as an entity (Milestone 15.2)', () => {
    const link = sourceLinkOf({ dynatrace: { tenant: 'main', id: 'calls:SERVICE-1->SERVICE-2', observedAt: '2026-10-15T08:46:00Z' } });
    expect(link).toMatchObject({ fromSpans: true, id: null, observedAt: '2026-10-15T08:46:00Z' });
  });

  it('marks an entity Dynatrace no longer sees', () => {
    expect(sourceLinkOf({ dynatrace: { name: 'payment', missingSince: '2026-10-15T08:45:00Z' } })?.missingSince).toBe('2026-10-15T08:45:00Z');
  });
});
