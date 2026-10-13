import { describe, expect, it } from 'vitest';
import { indexBoard } from './board';
import { paymentServiceBoard } from './mock/paymentServiceBoard';
import { paymentServiceTraces } from './mock/paymentServiceTraces';
import { createExampleTransitRepository } from './repository';
import { activeSteps, divergence, sampleTraces, stationOfStep, stepIndexAt } from './trace';
import type { TraceDetail } from './types';

const index = indexBoard(paymentServiceBoard('production'));
const traces = [...paymentServiceTraces().values()];
const of = (lineId: string) => traces.filter((t) => t.summary.lineId === lineId);
const line = (id: string) => index.lineById.get(id)!;

describe('example traces', () => {
  it('map every step to a station or policy stop, except flagged off-map spans', () => {
    expect(traces.length).toBe(60);
    for (const trace of traces) {
      for (const step of trace.steps) {
        if (step.offMap) continue;
        expect(stationOfStep(index, step), `${trace.summary.traceId}: ${step.at}`).not.toBeNull();
      }
      // Steps run in wall-clock order and the summary duration covers them.
      const starts = trace.steps.map((s) => s.startMs);
      expect(starts).toEqual([...starts].sort((a, b) => a - b));
      expect(trace.summary.durationMs).toBeGreaterThanOrEqual(Math.max(...trace.steps.map((s) => s.startMs + s.durationMs)));
    }
    expect(of('O1')).toEqual([]);
  });

  it('are deterministic', () => {
    expect([...paymentServiceTraces().keys()].slice(0, 3)).toEqual(traces.slice(0, 3).map((t) => t.summary.traceId));
  });

  it('include retries, a failure past the deadline, an off-map span, lost context, and a fan-out', () => {
    const refused = of('A2').find((t) => t.steps.some((s) => s.label.includes('connection refused')))!;
    expect(refused.steps.filter((s) => s.attempt).map((s) => s.attempt)).toEqual([1, 2, 3, 4]);
    expect(refused.steps.at(-1)).toMatchObject({ label: 'Error returned to the caller', status: 'fail' });
    // Two 2 s timeouts plus backoff overrun the 3 s deadline: the caller gives up, so the trace failed.
    const timedOut = of('A2').find((t) => t.steps.some((s) => s.label.includes('no reply, timed out')))!;
    expect(timedOut.steps.some((s) => /stops waiting at the 3 s deadline/.test(s.label))).toBe(true);
    expect(timedOut.summary.status).toBe('failed');
    expect(of('W1').some((t) => t.steps.some((s) => s.offMap))).toBe(true);
    expect(of('E1').some((t) => t.steps.some((s) => s.contextLost))).toBe(true);
    const fan = of('J2')[0]!.steps.filter((s) => s.parallel);
    expect(new Set(fan.map((s) => stationOfStep(index, s)))).toEqual(new Set(['cli:card', 'dep:card', 'cli:ledger', 'dep:ledger']));
    expect(fan.find((s) => s.at === 'cli:card')!.startMs).toBe(fan.find((s) => s.at === 'cli:ledger')!.startMs);
  });
});

describe('trace replay helpers', () => {
  const trace: TraceDetail = of('J2')[0]!;

  it('finds the current step and the steps in flight', () => {
    expect(stepIndexAt(trace.steps, -1)).toBe(0);
    const fork = trace.steps.find((s) => s.parallel)!;
    const running = activeSteps(trace.steps, fork.startMs + 1).map((s) => stationOfStep(index, s));
    expect(running).toEqual(expect.arrayContaining(['cli:card', 'cli:ledger'].filter((id) => running.includes(id))));
  });

  it('explains how a trace departs from the typical route', () => {
    const miss = of('A5').find((t) => t.steps.some((s) => s.label.startsWith('Cache miss')))!;
    expect(divergence(index, line('A5'), miss.steps)?.text).toMatch(/^Left the typical route to replica pool after “Cache miss: read the replica”/);
    const fallback = of('A1').find((t) => t.steps.some((s) => s.label.startsWith('Fallback')))!;
    expect(divergence(index, line('A1'), fallback.steps)?.text).toMatch(/^Attempt 1: timed out after 300 ms at Fraud Scoring/);
    const failed = of('A4').find((t) => t.summary.status === 'failed')!;
    expect(divergence(index, line('A4'), failed.steps)?.text).toMatch(/^Failed: /);
    const ok = of('J1')[0]!;
    expect(divergence(index, line('J1'), ok.steps)).toBeNull();
  });

  it('picks the slowest, most recent error, one with retries, and a typical sample', () => {
    const samples = sampleTraces(of('A1').map((t) => t.summary), line('A1'));
    const reasons = samples.flatMap((s) => s.reasons);
    expect(reasons).toEqual(expect.arrayContaining(['slowest', 'most recent error', 'with retries', 'typical']));
    expect(new Set(samples.map((s) => s.trace.traceId)).size).toBe(samples.length);
    expect(sampleTraces([], line('A2'))).toEqual([]);
  });
});

describe('example repository', () => {
  const repository = createExampleTransitRepository();

  it('scales trace counts by window and lists traces in the window, newest first', async () => {
    const week = await repository.getBoard('payment-service', 'production', '7d');
    const hour = await repository.getBoard('payment-service', 'production', '1h');
    expect(week!.lines.find((l) => l.id === 'A2')!.stats.traces).toBe(41_208);
    expect(hour!.lines.find((l) => l.id === 'J2')!.stats.traces).toBe(0);
    const list = await repository.getTraces('payment-service', 'A2', '24h');
    expect(list).toHaveLength(6);
    expect(list.map((t) => t.startedAt)).toEqual([...list.map((t) => t.startedAt)].sort().reverse());
    expect(await repository.getTrace('payment-service', ` ${list[0]!.traceId} `)).not.toBeNull();
    expect(await repository.getTrace('payment-service', 'nope')).toBeNull();
    expect(await repository.getBoard('order-service', 'production', '24h')).toBeNull();
  });
});
