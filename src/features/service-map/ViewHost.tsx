import { lazy, Suspense } from 'react';
import { useUiStore } from '../../state/uiStore';
import styles from './serviceMap.module.css';

// React Flow and the map code load only when the map is shown.
const Topology2D = lazy(() => import('./views/Topology2D').then((m) => ({ default: m.Topology2D })));

/**
 * Renderer-agnostic host for the active view. Topology and grouped infrastructure are two layout
 * modes of the same 2D graph. The lazy-loaded R3F galaxy replaces the 3D placeholder in Milestone 4.
 */
export function ViewHost() {
  const activeView = useUiStore((s) => s.activeView);

  if (activeView === '3d') {
    return (
      <div className={styles.placeholder} data-testid="view-placeholder">
        <div className={styles.placeholderCard}>
          <p className={styles.placeholderTag}>Placeholder · Milestone 4</p>
          <h2 className={styles.placeholderTitle}>3D Galaxy</h2>
          <p className={styles.placeholderBody}>
            Secondary, explorable view of the same canonical topology. Loaded on demand, with a 2D fallback when WebGL is
            unavailable.
          </p>
        </div>
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        <div className={styles.placeholder} role="status">
          Loading map…
        </div>
      }
    >
      <Topology2D />
    </Suspense>
  );
}
