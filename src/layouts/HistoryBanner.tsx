import { useTopology } from '../data/topologyContext';
import { formatTimestamp } from '../shared/format';
import { useUiStore } from '../state/uiStore';
import styles from './shell.module.css';

/** Always-visible notice while every view shows a read-only snapshot instead of current state. */
export function HistoryBanner() {
  const topology = useTopology();
  const setAsOf = useUiStore((s) => s.setAsOf);
  if (topology.status !== 'ready' || !topology.history) return null;
  const { history } = topology;
  return (
    <div className={styles.historyBanner} role="status">
      {history.status === 'ready' ? (
        <span>
          Viewing history: <b>{history.summary.label}</b> as of <span className="mono">{formatTimestamp(history.summary.takenAt)}</span> ·{' '}
          {history.summary.source === 'observed' ? 'observed data' : `${history.summary.source}, simulated data`} · read-only
        </span>
      ) : (
        <span>
          Snapshot <span className="mono">{history.id}</span> was not found. Showing the current state.
        </span>
      )}
      <button type="button" className={styles.bannerButton} onClick={() => setAsOf(null)}>
        Return to current
      </button>
    </div>
  );
}
