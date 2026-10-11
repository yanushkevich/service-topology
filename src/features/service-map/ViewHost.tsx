import { useUiStore } from '../../state/uiStore';
import styles from './serviceMap.module.css';

/**
 * Renderer-agnostic host for the active view. Real views (React Flow 2D in Milestone 2,
 * lazy-loaded R3F galaxy in Milestone 4) replace these placeholders behind the same switch.
 */
export function ViewHost() {
  const activeView = useUiStore((s) => s.activeView);
  const layoutMode = useUiStore((s) => s.layoutMode);

  if (activeView === '3d') {
    return (
      <ViewPlaceholder
        title="3D Galaxy"
        body="Secondary, explorable view of the same canonical topology. Loaded on demand, with a 2D fallback when WebGL is unavailable."
        milestone="Milestone 4"
      />
    );
  }

  return layoutMode === 'infrastructure' ? (
    <ViewPlaceholder
      title="2D Workbench — grouped infrastructure"
      body="The same topology, grouped by the explicit containment hierarchy (provider → account → region → cluster → namespace)."
      milestone="Milestone 2"
    />
  ) : (
    <ViewPlaceholder
      title="2D Workbench — topology"
      body="Primary operational view: services, topics, and queues as nodes, with communication relationships laid out by ELK."
      milestone="Milestone 2"
    />
  );
}

function ViewPlaceholder({ title, body, milestone }: { title: string; body: string; milestone: string }) {
  return (
    <div className={styles.placeholder} data-testid="view-placeholder">
      <div className={styles.placeholderCard}>
        <p className={styles.placeholderTag}>Placeholder · {milestone}</p>
        <h2 className={styles.placeholderTitle}>{title}</h2>
        <p className={styles.placeholderBody}>{body}</p>
      </div>
    </div>
  );
}
