import type { TopologyState } from '../../data/topologyContext';
import styles from './loadState.module.css';

/** Loading and error presentation for topology-backed views. Renders nothing once ready. */
export function LoadState({ state }: { state: TopologyState }) {
  if (state.status === 'loading') {
    return (
      <div className={styles.box} role="status">
        Loading topology…
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className={`${styles.box} ${styles.error}`} role="alert">
        <b>Could not load topology.</b> <span className="mono">{state.message}</span>
      </div>
    );
  }
  return null;
}
