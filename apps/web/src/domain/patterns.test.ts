import { describe, expect, it } from 'vitest';
import { POLICY_TYPES } from '../transit/types';
import { PATTERN_IDS, PATTERNS, isPatternId, patternDescription, patternLabel } from './patterns';
import { FLOW_POLICY_TYPES } from './types';

describe('pattern catalog (ADR-024)', () => {
  it('describes every pattern in one sentence with a label', () => {
    for (const id of PATTERN_IDS) {
      expect(PATTERNS[id].label.length, id).toBeGreaterThan(1);
      expect(PATTERNS[id].description, id).toMatch(/^[A-Z].*\.$/);
      expect(PATTERNS[id].appliesTo.length, id).toBeGreaterThan(0);
    }
  });

  it('contains every policy type of both boards', () => {
    for (const id of [...FLOW_POLICY_TYPES, ...POLICY_TYPES]) expect(isPatternId(id), id).toBe(true);
  });

  it('declares flow policies where flows can carry them (transitions or steps)', () => {
    for (const id of FLOW_POLICY_TYPES) {
      expect(PATTERNS[id].appliesTo.some((t) => t === 'call-transition' || t === 'event-transition' || t === 'step'), id).toBe(true);
    }
  });

  it('labels unknown IDs readably instead of failing', () => {
    expect(patternLabel('async-request-reply')).toBe('Async request-reply');
    expect(patternLabel('some-new-thing')).toBe('some new thing');
    expect(patternDescription('some-new-thing')).toBeUndefined();
  });
});
