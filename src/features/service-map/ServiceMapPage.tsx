import { useUiStore } from '../../state/uiStore';
import { InspectorPanel } from '../inspector/InspectorPanel';
import { ServiceMapToolbar } from './ServiceMapToolbar';
import { ViewHost } from './ViewHost';

export function ServiceMapPage() {
  const activeView = useUiStore((s) => s.activeView);

  return (
    <div className="absolute inset-0 flex flex-col">
      <h1 className="sr-only">Service Map</h1>
      <ServiceMapToolbar />
      <div className="flex min-h-0 flex-1 max-md:flex-col">
        <section
          className={
            activeView === '3d'
              ? 'relative min-w-0 flex-1 overflow-hidden bg-stage bg-[radial-gradient(ellipse_60%_50%_at_42%_46%,rgba(70,84,190,0.2),transparent_70%),radial-gradient(ellipse_40%_34%_at_68%_62%,rgba(40,150,190,0.11),transparent_70%)]'
              : 'relative min-w-0 flex-1 overflow-hidden bg-stage bg-[radial-gradient(circle,var(--color-stage-dot)_1px,transparent_1.4px)] bg-size-[28px_28px]'
          }
          aria-label="Topology canvas"
        >
          <ViewHost />
        </section>
        <InspectorPanel />
      </div>
    </div>
  );
}
