import { useUiStore, type LayoutMode, type ServiceMapView } from '../../state/uiStore';
import { Icon, type IconName } from '../../shared/ui/Icon';
import styles from './serviceMap.module.css';

const VIEW_OPTIONS: readonly { value: ServiceMapView; label: string; icon: IconName }[] = [
  { value: '2d', label: '2D Workbench', icon: 'view2d' },
  { value: '3d', label: '3D Galaxy', icon: 'view3d' },
];

const LAYOUT_OPTIONS: readonly { value: LayoutMode; label: string }[] = [
  { value: 'topology', label: 'Topology' },
  { value: 'infrastructure', label: 'Grouped infrastructure' },
];

export function ServiceMapToolbar() {
  const activeView = useUiStore((s) => s.activeView);
  const setActiveView = useUiStore((s) => s.setActiveView);
  const layoutMode = useUiStore((s) => s.layoutMode);
  const setLayoutMode = useUiStore((s) => s.setLayoutMode);

  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Service map controls">
      <div className={styles.toolbarEnd}>
        {activeView === '2d' && (
          <div className={styles.segmented} role="group" aria-label="Layout mode">
            {LAYOUT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={styles.segment}
                aria-pressed={layoutMode === option.value}
                onClick={() => setLayoutMode(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
        <div className={styles.segmented} role="group" aria-label="View">
          {VIEW_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={styles.segment}
              aria-pressed={activeView === option.value}
              onClick={() => setActiveView(option.value)}
            >
              <Icon name={option.icon} />
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
