import { describe, expect, it } from 'vitest';
import { createPlayback, playbackActions, stepAt } from './playback';

const timeline = { starts: [0, 0, 5, 20], total: 30 };

describe('board playback (shared by trace and transaction replay)', () => {
  it('finds the step at a time: the start is always the first step', () => {
    expect(stepAt(timeline, 0)).toBe(0);
    expect(stepAt(timeline, 1)).toBe(1); // two steps start at 0: the clock is past both
    expect(stepAt(timeline, 25)).toBe(3);
  });

  it('steps through every step, even ones sharing a start, and stops at the end', () => {
    const playback = createPlayback();
    const actions = playbackActions(playback, timeline);
    actions.step(1);
    expect(playback.get()).toMatchObject({ step: 1, t: 0 });
    actions.step(1);
    expect(playback.get()).toMatchObject({ step: 2, t: 5 });
    actions.jump(3);
    actions.step(1);
    expect(playback.get()).toMatchObject({ t: 30, playing: false });
    actions.step(-1);
    expect(playback.get().step).toBe(2);
  });

  it('toggles play, restarts at the end, seeks, and resets', () => {
    const playback = createPlayback();
    const actions = playbackActions(playback, timeline);
    actions.toggle();
    expect(playback.get().playing).toBe(true);
    playback.set({ t: 30, playing: false });
    actions.toggle();
    expect(playback.get()).toMatchObject({ t: 0, step: 0, playing: true });
    actions.seek(21);
    expect(playback.get()).toMatchObject({ t: 21, step: 3, playing: false });
    actions.reset();
    expect(playback.get()).toMatchObject({ t: 0, step: 0 });
  });
});
