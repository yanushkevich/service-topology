import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockTopology } from '../data/mock/topology';
import { useSimulationStore } from './simulationStore';
import { useSimulationTicker } from './useSimulationTicker';

describe('useSimulationTicker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useSimulationStore.setState({ sim: null, running: false, speed: 'normal' });
    useSimulationStore.getState().initialize(mockTopology);
  });
  afterEach(() => vi.useRealTimers());

  const tick = () => useSimulationStore.getState().sim?.tick;

  it('steps only while running, at the selected speed', () => {
    renderHook(() => useSimulationTicker());
    act(() => vi.advanceTimersByTime(10_000));
    expect(tick()).toBe(0);

    act(() => useSimulationStore.getState().setRunning(true));
    act(() => vi.advanceTimersByTime(4_000)); // 1× = every 2 s
    expect(tick()).toBe(2);

    act(() => useSimulationStore.getState().setSpeed('fast'));
    act(() => vi.advanceTimersByTime(1_000)); // 4× = every 500 ms
    expect(tick()).toBe(4);

    act(() => useSimulationStore.getState().setRunning(false));
    act(() => vi.advanceTimersByTime(10_000));
    expect(tick()).toBe(4);
  });

  it('stops when unmounted', () => {
    const { unmount } = renderHook(() => useSimulationTicker());
    act(() => useSimulationStore.getState().setRunning(true));
    unmount();
    act(() => vi.advanceTimersByTime(10_000));
    expect(tick()).toBe(0);
  });

  it('keeps the simulation when initialized again with the same data', () => {
    useSimulationStore.getState().inject('payment-service.production', 'unavailable');
    useSimulationStore.getState().initialize(mockTopology);
    expect(useSimulationStore.getState().sim?.failures).toHaveLength(1);
  });
});
