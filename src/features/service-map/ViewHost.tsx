import { lazy, Suspense } from 'react';
import { useUiStore } from '../../state/uiStore';
import styles from './serviceMap.module.css';

// React Flow and the map code load only when the map is shown; Three.js only when 3D is opened.
const Topology2D = lazy(() => import('./views/Topology2D').then((m) => ({ default: m.Topology2D })));
const Network3DView = lazy(() => import('./galaxy/Network3DView').then((m) => ({ default: m.Network3DView })));

/**
 * Renderer-agnostic host for the active view. Topology and grouped infrastructure are two layout
 * modes of the same 2D graph; the 3D galaxy is a separate, optional, lazy-loaded renderer of the
 * same canonical data and shared state.
 */
export function ViewHost() {
  const activeView = useUiStore((s) => s.activeView);

  return (
    <Suspense
      fallback={
        <div className={styles.placeholder} role="status">
          {activeView === '3d' ? 'Loading 3D galaxy…' : 'Loading map…'}
        </div>
      }
    >
      {activeView === '3d' ? <Network3DView /> : <Topology2D />}
    </Suspense>
  );
}
