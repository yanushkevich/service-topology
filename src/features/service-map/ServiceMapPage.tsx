import { useUiStore } from '../../state/uiStore';
import { InspectorPanel } from '../inspector/InspectorPanel';
import { ServiceMapToolbar } from './ServiceMapToolbar';
import { ViewHost } from './ViewHost';
import styles from './serviceMap.module.css';

export function ServiceMapPage() {
  const activeView = useUiStore((s) => s.activeView);

  return (
    <div className={styles.workspace}>
      <h1 className="visually-hidden">Service Map</h1>
      <ServiceMapToolbar />
      <div className={styles.content}>
        <section
          className={`${styles.stage} ${activeView === '3d' ? styles.stage3d : ''}`}
          aria-label="Topology canvas"
        >
          <ViewHost />
        </section>
        <InspectorPanel />
      </div>
    </div>
  );
}
