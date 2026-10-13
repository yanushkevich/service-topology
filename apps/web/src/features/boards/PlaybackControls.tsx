import { useId } from 'react';
import { buttonClass, cx, fieldClass } from '../../shared/ui/classes';
import { SPEEDS, usePlayback, type Playback } from './playback';

/** Play/Pause/Replay, Back, Next, and speed for a replay (trace or business transaction). */
export function PlaybackControls({ playback, ended, onPlay, onStep, children }: { playback: Playback; ended: boolean; onPlay: () => void; onStep: (direction: -1 | 1) => void; children?: React.ReactNode }) {
  const speedId = useId();
  const playing = usePlayback(playback, (s) => s.playing);
  const speed = usePlayback(playback, (s) => s.speed);
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-2">
      <button type="button" className={buttonClass('primary', 'h-7.5')} onClick={onPlay}>
        {playing ? 'Pause' : ended ? 'Replay' : 'Play'}
      </button>
      <button type="button" className={buttonClass('secondary', 'h-7.5')} onClick={() => onStep(-1)}>
        Back
      </button>
      <button type="button" className={buttonClass('secondary', 'h-7.5')} onClick={() => onStep(1)}>
        Next
      </button>
      <label htmlFor={speedId} className="sr-only">
        Speed
      </label>
      <select id={speedId} className={cx(fieldClass, 'h-7.5 w-auto px-1.5 text-xs')} value={speed} onChange={(e) => playback.set({ speed: Number(e.target.value) })}>
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s}×
          </option>
        ))}
      </select>
      {children}
    </div>
  );
}
