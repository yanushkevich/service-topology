import { useTopology } from '../data/topologyContext';
import { formatTimestamp } from '../shared/format';
import { useUiStore } from '../state/uiStore';

/** Always-visible notice while every view shows a read-only snapshot instead of current state. */
export function HistoryBanner() {
  const topology = useTopology();
  const setAsOf = useUiStore((s) => s.setAsOf);
  if (topology.status !== 'ready' || !topology.history) return null;
  const { history } = topology;
  return (
    <div className="flex flex-none flex-wrap items-center gap-2.5 border-b border-dashed border-warn bg-[color-mix(in_srgb,var(--color-warn)_10%,var(--color-bg-1))] px-3.5 py-[7px] text-sm text-fg" role="status">
      {history.status === 'ready' ? (
        <span>
          Viewing history: <b>{history.summary.label}</b> as of <span className="font-mono">{formatTimestamp(history.summary.takenAt)}</span> ·{' '}
          {history.summary.source === 'observed' ? 'observed data' : `${history.summary.source}, simulated data`} · read-only
        </span>
      ) : (
        <span>
          Snapshot <span className="font-mono">{history.id}</span> was not found. Showing the current state.
        </span>
      )}
      <button type="button" className="h-6.5 rounded-md border border-line-strong bg-surface-2 px-2.5" onClick={() => setAsOf(null)}>
        Return to current
      </button>
    </div>
  );
}
