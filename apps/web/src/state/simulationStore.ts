import { create } from 'zustand';
import type { FailureMode } from '../domain/propagation';
import type { EntityId, TopologyData } from '../domain/types';
import { usePreferencesStore } from './preferencesStore';
import {
  createSimulation,
  injectFailure,
  recover,
  recoverAll,
  reset,
  step,
  type SimulationState,
} from '../simulation/engine';

/**
 * Cross-view simulation state. The engine is pure; this store only holds its current value and the
 * run controls. Ticks are driven by useSimulationTicker (one interval at the app shell), never by
 * renderers or animation frames.
 */

export const SIMULATION_SPEEDS = [
  { id: 'slow', label: '0.5×', intervalMs: 4000 },
  { id: 'normal', label: '1×', intervalMs: 2000 },
  { id: 'fast', label: '4×', intervalMs: 500 },
] as const;
export type SimulationSpeed = (typeof SIMULATION_SPEEDS)[number]['id'];

interface SimulationStore {
  sim: SimulationState | null;
  running: boolean;
  speed: SimulationSpeed;
  /** Start (or restart) from freshly loaded data. Keeps the current simulation if the baseline is the same object. */
  initialize: (baseline: TopologyData) => void;
  step: () => void;
  inject: (entityId: EntityId, mode: FailureMode, durationTicks?: number) => void;
  recover: (entityId: EntityId) => void;
  recoverAll: () => void;
  reset: () => void;
  setRunning: (running: boolean) => void;
  setSpeed: (speed: SimulationSpeed) => void;
}

export const useSimulationStore = create<SimulationStore>()((set, get) => {
  const update = (fn: (sim: SimulationState) => SimulationState) => {
    const { sim } = get();
    if (sim) set({ sim: fn(sim) });
  };
  return {
    sim: null,
    running: false,
    speed: usePreferencesStore.getState().preferences.simulationSpeed,
    initialize: (baseline) => {
      if (get().sim?.baseline === baseline) return;
      set({ sim: createSimulation(baseline), running: false });
    },
    step: () => update((sim) => step(sim)),
    inject: (entityId, mode, durationTicks) =>
      update((sim) => injectFailure(sim, entityId, mode, durationTicks === undefined ? {} : { durationTicks })),
    recover: (entityId) => update((sim) => recover(sim, entityId)),
    recoverAll: () => update((sim) => recoverAll(sim)),
    reset: () => {
      update((sim) => reset(sim));
      set({ running: false });
    },
    setRunning: (running) => set({ running }),
    setSpeed: (speed) => set({ speed }),
  };
});
