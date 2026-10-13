import { useId, type ReactNode } from 'react';
import type { TopologyIndex } from '../../domain/topologyIndex';
import { useTopology } from '../../data/topologyContext';
import { DataSourceTag } from '../../shared/ui/DataSourceTag';
import { LoadState } from '../../shared/ui/LoadState';
import { InspectorPanel } from '../inspector/InspectorPanel';

/** Section page layout: scrollable content plus the shared inspector (same as registry/events). */
export function PageShell({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: (index: TopologyIndex) => ReactNode;
}) {
  const topology = useTopology();
  return (
    <div className="absolute inset-0 flex max-md:flex-col">
      <div className="flex min-w-0 flex-1 flex-col gap-3.5 overflow-auto px-5 pt-[18px] pb-8 max-md:min-h-0 max-md:px-3 max-md:pt-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="m-0 text-xl font-semibold">{title}</h1>
          {topology.status === 'ready' && <DataSourceTag sourceLabel={topology.sourceLabel} isMock={topology.isMock} />}
          {actions && <div className="ml-auto flex flex-wrap gap-2">{actions}</div>}
        </div>
        {topology.status === 'ready' ? children(topology.index) : <LoadState state={topology} />}
      </div>
      <InspectorPanel hideWhenEmpty />
    </div>
  );
}

/** Content card (mock .card): a labelled region with a heading and optional header actions. */
export function Card({ title, aside, children, className }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={`rounded-xl border border-line bg-surface-1 px-4 py-3.5 ${className ?? ''}`}>
      <div className="mb-2.5 flex flex-wrap items-center gap-2.5">
        <h2 id={id} className="m-0 text-lg font-semibold">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Empty or explanatory state inside a card. */
export function Note({ children }: { children: ReactNode }) {
  return <p className="m-0 rounded-[9px] border border-dashed border-line-strong px-[11px] py-[9px] text-sm text-fg-2">{children}</p>;
}
