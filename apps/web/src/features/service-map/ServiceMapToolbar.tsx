import { useUiStore, type LayoutMode, type ServiceMapView } from '../../state/uiStore';
import { Icon, type IconName } from '../../shared/ui/Icon';
import { useTopology } from '../../data/topologyContext';
import { EventHighlightChip } from '../event-catalog/EventHighlightChip';

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
  const topology = useTopology();

  return (
    <div className="flex min-h-[46px] flex-none flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line bg-surface-1 px-3.5 py-1.5" role="toolbar" aria-label="Service map controls">
      <EventHighlightChip index={topology.status === 'ready' ? topology.index : null} />
      <div className="ml-auto flex flex-wrap gap-2">
        {activeView === '2d' && (
          <div className="flex gap-0.5 rounded-[9px] border border-line bg-surface-2 p-[3px]" role="group" aria-label="Layout mode">
            {LAYOUT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className="flex h-6.5 items-center gap-1.5 rounded-sm px-2.75 text-sm whitespace-nowrap text-fg-2 hover:text-fg aria-pressed:bg-selected aria-pressed:text-fg aria-pressed:shadow-[inset_0_0_0_1px_var(--color-line-strong),inset_0_-2px_0_var(--color-accent)] aria-pressed:[&_svg]:text-accent"
                aria-pressed={layoutMode === option.value}
                onClick={() => setLayoutMode(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-0.5 rounded-[9px] border border-line bg-surface-2 p-[3px]" role="group" aria-label="View">
          {VIEW_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className="flex h-6.5 items-center gap-1.5 rounded-sm px-2.75 text-sm whitespace-nowrap text-fg-2 hover:text-fg aria-pressed:bg-selected aria-pressed:text-fg aria-pressed:shadow-[inset_0_0_0_1px_var(--color-line-strong),inset_0_-2px_0_var(--color-accent)] aria-pressed:[&_svg]:text-accent"
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
