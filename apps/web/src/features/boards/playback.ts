import { useEffect, useRef, useSyncExternalStore } from 'react';

/**
 * Trace playback clock (spec "Playback"): a tiny store local to one board, so the per-frame clock
 * re-renders only the components that read it (the train marker, the progress, the active step),
 * never the map. Nothing here is global state (ARCHITECTURE "State ownership").
 */
export interface PlaybackState {
  /** Trace time in ms. */
  t: number;
  /**
   * Index of the current step. Kept beside `t` because steps can share a start time (zero-length
   * steps): stepping and playback visit each of them in turn.
   */
  step: number;
  playing: boolean;
  speed: number;
}

export interface Playback {
  get(): PlaybackState;
  set(next: Partial<PlaybackState>): void;
  subscribe(listener: () => void): () => void;
}

export function createPlayback(initial: Partial<PlaybackState> = {}): Playback {
  let state: PlaybackState = { t: 0, step: 0, playing: false, speed: 1, ...initial };
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next) {
      const merged = { ...state, ...next };
      if (merged.t === state.t && merged.step === state.step && merged.playing === state.playing && merged.speed === state.speed) return;
      state = merged;
      listeners.forEach((l) => l());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Subscribe to a derived value; the component re-renders only when the value changes. */
export function usePlayback<T>(playback: Playback, select: (state: PlaybackState) => T): T {
  return useSyncExternalStore(playback.subscribe, () => select(playback.get()));
}

/** A whole replay plays in about this many seconds at 1×, whatever its real duration. */
export const PLAYBACK_SECONDS = 6;
export const SPEEDS = [0.25, 1, 4] as const;
/** Each step stays current for at least this long at 1× (steps can share a start time). */
const MIN_DWELL_MS = 400;
/** With reduced motion the replay moves one step this often instead of animating. */
const REDUCED_STEP_MS = 700;

/** What the clock needs to know about a replay: when each step starts, and where it ends. */
export interface Timeline {
  starts: readonly number[];
  total: number;
}

/** The step the clock is on at t: the last one that has started (0 at the very start). */
export function stepAt(timeline: Timeline, t: number): number {
  if (t <= 0) return 0;
  let at = 0;
  timeline.starts.forEach((start, i) => {
    if (start <= t) at = i;
  });
  return at;
}

/**
 * Drives the playback store while it plays: in real time scaled to PLAYBACK_SECONDS, giving every
 * step a moment on screen; with reduced motion, one step at a time. Stops at the end.
 */
export function usePlaybackClock(playback: Playback, timeline: Timeline | null, reduced: boolean) {
  const playing = usePlayback(playback, (s) => s.playing);
  useEffect(() => {
    if (!playing || !timeline) return;
    const { starts, total } = timeline;
    const last = starts.length - 1;
    if (reduced) {
      const timer = setInterval(() => {
        const { step } = playback.get();
        if (step >= last) playback.set({ t: total, step: last, playing: false });
        else playback.set({ step: step + 1, t: starts[step + 1] ?? total });
      }, REDUCED_STEP_MS);
      return () => clearInterval(timer);
    }
    const rate = Math.max(1, total) / (PLAYBACK_SECONDS * 1000);
    let frame = 0;
    let previous = 0;
    let changed = performance.now();
    const tick = (now: number) => {
      const { t, step, speed } = playback.get();
      const dt = previous ? now - previous : 16;
      previous = now;
      const advanced = Math.min(total, t + dt * rate * speed);
      const next = starts[step + 1];
      if (next !== undefined && next <= advanced) {
        if (now - changed >= MIN_DWELL_MS / speed) {
          changed = now;
          playback.set({ step: step + 1, t: Math.max(t, next) });
        } else playback.set({ t: Math.min(advanced, next) });
      } else if (next === undefined && advanced >= total) {
        playback.set({ t: total, playing: false });
        return;
      } else playback.set({ t: advanced });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, timeline, reduced, playback]);
}

/** The replay controls' actions on a playback store (pausing on every manual move). */
export function playbackActions(playback: Playback, timeline: Timeline | null) {
  const jump = (step: number) => {
    const start = timeline?.starts[step];
    if (start !== undefined) playback.set({ step, t: start, playing: false });
  };
  return {
    seek: (t: number) => timeline && playback.set({ t, step: stepAt(timeline, t), playing: false }),
    jump,
    step: (direction: -1 | 1) => {
      if (!timeline) return;
      const { step } = playback.get();
      if (direction > 0 && step >= timeline.starts.length - 1) playback.set({ t: timeline.total, playing: false });
      else jump(Math.max(0, step + direction));
    },
    toggle: () => {
      if (!timeline) return;
      const { t, playing } = playback.get();
      if (!playing && t >= timeline.total) playback.set({ t: 0, step: 0, playing: true });
      else playback.set({ playing: !playing });
    },
    reset: () => playback.set({ t: 0, step: 0, playing: false }),
  };
}

/**
 * Keeps a replay and the URL in step: a new timeline (another trace or transaction) starts paused
 * at the shared link's time once, then at 0; while paused, the time is written back through
 * `writeTime` (only while paused, so playing does not flood the browser history).
 */
export function useReplayUrlTime(playback: Playback, timeline: Timeline | null, options: { linkedTime: string | null; enabled: boolean; writeTime: (value: string | null) => void }) {
  const linked = useRef(options.linkedTime);
  useEffect(() => {
    if (!timeline) return;
    const requested = linked.current === null ? 0 : Number(linked.current);
    linked.current = null;
    const t = Number.isFinite(requested) ? Math.max(0, Math.min(requested, timeline.total)) : 0;
    playback.set({ t, step: stepAt(timeline, t), playing: false });
  }, [timeline, playback]);

  const pausedT = usePlayback(playback, (s) => (s.playing ? null : Math.round(s.t)));
  const { enabled, writeTime } = options;
  const write = useRef(writeTime);
  useEffect(() => {
    write.current = writeTime;
  });
  useEffect(() => {
    if (!enabled || !timeline || pausedT === null) return;
    write.current(pausedT > 0 ? String(pausedT) : null);
  }, [enabled, timeline, pausedT]);
}
