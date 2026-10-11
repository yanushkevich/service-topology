import type { TopologyState } from '../../data/topologyContext';

/** Loading and error presentation for topology-backed views. Renders nothing once ready. */
export function LoadState({ state }: { state: TopologyState }) {
  if (state.status === 'loading') {
    return (
      <div className="my-4 rounded-lg border border-dashed border-line-strong px-4 py-3.5 text-fg-2" role="status">
        Loading topology…
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="my-4 rounded-lg border border-crit px-4 py-3.5 text-fg" role="alert">
        <b>Could not load topology.</b> <span className="font-mono text-crit-fg">{state.message}</span>
      </div>
    );
  }
  return null;
}
