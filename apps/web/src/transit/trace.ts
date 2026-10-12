import { lineStations, type BoardIndex } from './board';
import type { Line, TraceDetail, TraceStep, TraceSummary } from './types';

/**
 * Trace replay helpers (docs/TRANSIT_BOARD.md "Trace replay mode"): pure functions over a trace
 * that is already mapped to station and policy-stop ids.
 */

/** Index of the step the clock is on: the last step that has started (0 before the first). */
export function stepIndexAt(steps: readonly TraceStep[], t: number): number {
  let at = 0;
  steps.forEach((step, i) => {
    if (step.startMs <= t) at = i;
  });
  return at;
}

/** Steps running at time t: the current step (by cursor) plus any parallel step still in flight. */
export function activeSteps(steps: readonly TraceStep[], t: number, cursor = stepIndexAt(steps, t)): TraceStep[] {
  const current = steps[cursor];
  const running = steps.filter((s) => s.parallel && s.startMs <= t && t < s.startMs + Math.max(1, s.durationMs));
  return current && !running.includes(current) ? [current, ...running] : running.length ? running : current ? [current] : [];
}

/** Start time of the next / previous distinct step from t (for Left / Right and Next / Back). */
export function nextStepStart(steps: readonly TraceStep[], t: number, duration: number): number {
  return steps.find((s) => s.startMs > t)?.startMs ?? duration;
}

export function previousStepStart(steps: readonly TraceStep[], t: number): number {
  const earlier = steps.filter((s) => s.startMs < t);
  return earlier.at(-1)?.startMs ?? 0;
}

/** The station a step happened at: a station id, the client lane of a policy stop, or null (off-map). */
export function stationOfStep(index: BoardIndex, step: TraceStep): string | null {
  if (step.offMap) return null;
  if (index.stations.has(step.at)) return step.at;
  return index.board.policies.find((p) => p.id === step.at)?.clientId ?? null;
}

export interface Divergence {
  /** Index of the first step that departs from the typical route. */
  stepIndex: number;
  text: string;
}

/**
 * Where a replayed trace leaves the typical route (spec "Divergence"): a station off the typical
 * route (an alternative branch), the first retry, fallback, or failure, or a stop before the
 * typical route's end. Off-map spans and lost context are limits of the data, not divergence.
 */
export function divergence(index: BoardIndex, line: Line, steps: readonly TraceStep[]): Divergence | null {
  const typical = new Set(line.route.filter((b) => b.kind === 'sequential').flatMap((b) => b.stations));
  const name = (id: string) => index.stations.get(id)?.name ?? id;
  const mapped = steps.map((step, i) => ({ step, i, station: step.offMap || step.contextLost ? null : stationOfStep(index, step) })).filter((m) => !m.step.offMap && !m.step.contextLost);
  // Leaving the route is the most telling difference, then a failure, then the first retry or fallback.
  const off = mapped.find((m) => m.station && !typical.has(m.station));
  if (off?.station) {
    const before = steps.slice(0, off.i).reverse().find((s) => s.status !== 'ok');
    return { stepIndex: off.i, text: `Left the typical route to ${name(off.station)}${before ? ` after “${before.label}”` : ''}; typical requests do not go there.` };
  }
  const fail = mapped.find((m) => m.step.status === 'fail');
  if (fail) {
    const reached = new Set(steps.slice(0, fail.i + 1).map((s) => stationOfStep(index, s)));
    const missed = lineStations(line).filter((id) => typical.has(id) && !reached.has(id) && index.stations.get(id)?.kind === 'dependency');
    return { stepIndex: fail.i, text: `Failed: ${fail.step.label}.${missed.length ? ` It never reached ${missed.map(name).join(', ')}, which typical requests call.` : ''}` };
  }
  const warn = mapped.find((m) => m.step.status === 'warn');
  if (warn) return { stepIndex: warn.i, text: `${warn.step.label} at ${name(warn.station ?? warn.step.at)}; typical requests pass here without retries or fallbacks.` };
  return null;
}

export type SampleReason = 'slowest' | 'most recent error' | 'with retries' | 'typical';

/** Sample traces for a line (spec "Picking a trace"): slowest, most recent error, one with retries, typical. */
export function sampleTraces(traces: readonly TraceSummary[], line: Line): { trace: TraceSummary; reasons: SampleReason[] }[] {
  if (traces.length === 0) return [];
  const newestFirst = [...traces].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const picks: [SampleReason, TraceSummary | undefined][] = [
    ['slowest', [...traces].sort((a, b) => b.durationMs - a.durationMs)[0]],
    ['most recent error', newestFirst.find((t) => t.status === 'failed')],
    ['with retries', newestFirst.find((t) => t.retries > 0 && t.status !== 'failed')],
    ['typical', [...traces].sort((a, b) => Math.abs(a.durationMs - line.stats.p50Ms) - Math.abs(b.durationMs - line.stats.p50Ms))[0]],
  ];
  const out: { trace: TraceSummary; reasons: SampleReason[] }[] = [];
  for (const [reason, trace] of picks) {
    if (!trace) continue;
    const existing = out.find((o) => o.trace.traceId === trace.traceId);
    if (existing) existing.reasons.push(reason);
    else out.push({ trace, reasons: [reason] });
  }
  return out;
}

/** Playback speed: the whole trace plays in about 6 s at 1×, whatever its real duration. */
export const PLAYBACK_SECONDS = 6;
export const SPEEDS = [0.25, 1, 4] as const;
export type Speed = (typeof SPEEDS)[number];

export const traceMsPerFrameMs = (detail: TraceDetail, speed: number) => (Math.max(1, detail.summary.durationMs) / (PLAYBACK_SECONDS * 1000)) * speed;
