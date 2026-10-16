import { describe, expect, it } from 'vitest';
import { sourceLinkOf } from './sourceLink';

describe('sourceLinkOf', () => {
  it('reads the Dynatrace link, problems, and observation time', () => {
    expect(sourceLinkOf({ dynatrace: { tenant: 'main', id: 'SERVICE-1', observedAt: '2026-10-15T08:46:00Z', problems: ['P-1', 7] }, owner: 'x' })).toEqual({
      tenant: 'main', id: 'SERVICE-1', name: null, observedAt: '2026-10-15T08:46:00Z', problems: ['P-1'], missingSince: null, messaging: null,
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

  it('marks an entity Dynatrace no longer sees', () => {
    expect(sourceLinkOf({ dynatrace: { name: 'payment', missingSince: '2026-10-15T08:45:00Z' } })?.missingSince).toBe('2026-10-15T08:45:00Z');
  });
});
