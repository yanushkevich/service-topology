import { useSyncExternalStore } from 'react';

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
