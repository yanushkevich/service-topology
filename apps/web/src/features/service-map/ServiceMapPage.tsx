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
              ? 'relative min-w-0 flex-1 overflow-hidden bg-stage bg-(image:--stage-glow)'
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
