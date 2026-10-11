import { useEffect } from 'react';
import { SIMULATION_SPEEDS, useSimulationStore } from './simulationStore';

/** The single simulation timer, mounted once at the app shell. */
export function useSimulationTicker() {
  const running = useSimulationStore((s) => s.running);
  const speed = useSimulationStore((s) => s.speed);
  useEffect(() => {
    if (!running) return;
    const intervalMs = SIMULATION_SPEEDS.find((s) => s.id === speed)?.intervalMs ?? 2000;
    const timer = window.setInterval(() => useSimulationStore.getState().step(), intervalMs);
    return () => window.clearInterval(timer);
  }, [running, speed]);
}
