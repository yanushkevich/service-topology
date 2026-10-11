import { describe, expect, it, vi } from 'vitest';
import { approachPose, CameraMemory, fitPose, focusPose } from './cameraMath';
import { detectWebGL, watchContextLoss } from './webgl';

describe('detectWebGL', () => {
  it('is false in jsdom (no WebGL) and when context creation throws', () => {
    expect(detectWebGL()).toBe(false);
    expect(detectWebGL(() => { throw new Error('blocked'); })).toBe(false);
  });

  it('is true when a context is available', () => {
    const canvas = { getContext: (kind: string) => (kind === 'webgl' ? {} : null) } as unknown as HTMLCanvasElement;
    expect(detectWebGL(() => canvas)).toBe(true);
  });
});

describe('watchContextLoss', () => {
  it('reports loss (preventing default so it can be restored) and restoration, and cleans up', () => {
    const canvas = document.createElement('canvas');
    const onLost = vi.fn();
    const onRestored = vi.fn();
    const stop = watchContextLoss(canvas, onLost, onRestored);
    const lost = new Event('webglcontextlost', { cancelable: true });
    canvas.dispatchEvent(lost);
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(lost.defaultPrevented).toBe(true);
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(onRestored).toHaveBeenCalledTimes(1);
    stop();
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    expect(onLost).toHaveBeenCalledTimes(1);
  });
});

describe('camera math', () => {
  it('fits the scope extent inside the field of view', () => {
    const pose = fitPose(500);
    const distance = Math.hypot(...pose.position);
    expect(distance).toBeGreaterThan(500 / Math.sin((25 * Math.PI) / 180));
    expect(pose.target).toEqual([0, 0, 0]);
  });

  it('focuses a node while keeping the viewing direction', () => {
    const current = { position: [0, 0, 1000] as const, target: [0, 0, 0] as const };
    expect(focusPose(current, [100, 50, 0], 10)).toEqual({ target: [100, 50, 0], position: [100, 50, 160] });
    const near = approachPose(current, [100, 50, 0], 10);
    expect(near.position[2]).toBeCloseTo(22);
  });

  it('remembers camera context per scope and forgets deeper scopes', () => {
    const memory = new CameraMemory();
    const pose = { position: [1, 2, 3] as const, target: [0, 0, 0] as const };
    memory.save([], pose);
    memory.save(['a'], pose);
    memory.save(['a', 'b'], pose);
    memory.forgetBelow(['a']);
    expect(memory.restore(['a'])).toEqual(pose);
    expect(memory.restore(['a', 'b'])).toBeUndefined();
    expect(memory.restore([])).toEqual(pose);
    memory.forgetBelow([]);
    expect(memory.restore(['a'])).toBeUndefined();
    expect(memory.restore([])).toEqual(pose);
  });
});
