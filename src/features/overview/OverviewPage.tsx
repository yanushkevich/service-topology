import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useTopology } from '../../data/topologyContext';
import { PROPAGATION_RULES } from '../../domain/propagation';
import { environmentSummary } from '../../domain/summary';
import { buildTopologyIndex, endpointName, type TopologyIndex } from '../../domain/topologyIndex';
import type { EntityRef, HealthStatus } from '../../domain/types';
import { formatClock } from '../../shared/format';
import { healthLabel, providerLabel, typeLabel } from '../../shared/mappings';
import { buttonClass, kickerClass } from '../../shared/ui/classes';
import { SimulatedTag } from '../../shared/ui/DataSourceTag';
import { StatusShape } from '../../shared/ui/StatusShape';
import { TypeGlyph } from '../../shared/ui/TypeGlyph';
import { useSimulationStore } from '../../state/simulationStore';
import { useUiStore } from '../../state/uiStore';
import { describeEvent } from '../events/describeEvent';
import { Card, Note, PageShell } from '../pages/PageShell';

const HEALTH_ORDER: HealthStatus[] = ['unavailable', 'degraded', 'unknown', 'healthy'];

/** Overview (PRODUCT_SPEC Revision 5 §K.1): environment summary, what needs attention, quick actions. */
export function OverviewPage() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const go = (pathname: string) => navigate({ pathname, search });
  const openMap = (view: '2d' | '3d') => {
    useUiStore.getState().setActiveView(view);
    go('/map');
  };
  const openUnhealthy = () => {
    useUiStore.getState().setFilters({ health: ['unavailable', 'degraded'] });
    go('/registry');
  };
  return (
    <PageShell
      title="Overview"
      actions={
        <>
          <button type="button" className={buttonClass('primary')} onClick={() => openMap('2d')}>
            Open 2D map
          </button>
          <button type="button" className={buttonClass('secondary')} onClick={() => openMap('3d')}>
            Open 3D galaxy
          </button>
          <button type="button" className={buttonClass('secondary')} onClick={openUnhealthy}>
            Registry: unhealthy only
          </button>
        </>
      }
    >
      {(index) => <OverviewContent index={index} />}
    </PageShell>
  );
}

function OverviewContent({ index }: { index: TopologyIndex }) {
  const environmentId = useUiStore((s) => s.environmentId);
  const select = useUiStore((s) => s.select);
  const topology = useTopology();
  const sim = useSimulationStore((s) => s.sim);
  const running = useSimulationStore((s) => s.running);
  const navigate = useNavigate();
  const { search } = useLocation();
  const summary = useMemo(() => environmentSummary(index, environmentId), [index, environmentId]);
  const environmentName = index.environments.get(environmentId)?.name ?? environmentId;
  const history = topology.status === 'ready' ? topology.history : null;
  const baselineIndex = useMemo(() => (sim ? buildTopologyIndex(sim.baseline) : null), [sim]);
  const impactOf = (id: string) => (history ? undefined : sim?.impacts.find((i) => i.entityId === id));
  const failed = (id: string) => (history ? undefined : sim?.failures.find((f) => f.entityId === id));
  const showOnMap = (ref: EntityRef) => {
    select(ref);
    useUiStore.getState().setActiveView('2d');
    navigate({ pathname: '/map', search });
  };

  const tiles: { label: string; value: number; health?: HealthStatus }[] = [
    { label: 'Service instances', value: summary.instances },
    { label: 'Resources', value: summary.resources },
    { label: 'Relationships', value: summary.relationships },
    ...HEALTH_ORDER.map((h) => ({ label: healthLabel(h), value: summary.byHealth[h], health: h })),
  ];

  return (
    <>
      <p className="m-0 font-mono text-[11.5px] text-fg-3">
        {environmentName}
        {history?.status === 'ready' ? ` · as of snapshot "${history.summary.label}"` : ' · current state'}
      </p>

      <section aria-label="Summary" className="grid grid-cols-[repeat(auto-fit,minmax(124px,1fr))] gap-3">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg border border-line bg-surface-3/60 px-4 py-3.5">
            <div className={`flex items-center gap-1.5 ${kickerClass}`}>
              {t.health && <StatusShape health={t.health} />}
              {t.label}
            </div>
            <div className="mt-1 text-2xl font-semibold">{t.value}</div>
          </div>
        ))}
      </section>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-3.5">
        <Card title="Needs attention" aside={<span className="font-mono text-sm text-fg-3">{summary.needsAttention.length}</span>}>
          {summary.needsAttention.length === 0 ? (
            <Note>Nothing in {environmentName} is degraded or unavailable.</Note>
          ) : (
            <ul className="m-0 list-none p-0" aria-label="Unhealthy entities">
              {summary.needsAttention.map((row) => {
                const impact = impactOf(row.ref.id);
                const failure = failed(row.ref.id);
                const rule = impact ? PROPAGATION_RULES.find((r) => r.id === impact.ruleId) : undefined;
                return (
                  <li key={row.ref.id} className="flex flex-wrap items-center gap-2 border-t border-line py-2 first:border-t-0">
                    <TypeGlyph type={row.type} size={14} />
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => select(row.ref)}>
                      <span className="block truncate font-semibold">{row.name}</span>
                      <span className="block text-xs text-fg-3">
                        {typeLabel(row.type)} · {providerLabel(row.provider)}
                        {failure && ' · simulated failure'}
                        {impact && rule && ` · simulated: ${rule.title.toLowerCase()} via ${endpointName(baselineIndex ?? index, impact.causeId)}`}
                      </span>
                    </button>
                    <StatusShape health={row.health} label />
                    <button type="button" className={buttonClass('ghost')} onClick={() => showOnMap(row.ref)} aria-label={`Show on map: ${row.name}`}>
                      Show on map
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title="Providers">
          <table className="w-full border-collapse text-sm [&_td]:border-t [&_td]:border-line [&_td]:py-1.5 [&_th]:pb-1.5 [&_th]:text-left [&_th]:font-normal">
            <thead>
              <tr className={kickerClass}>
                <th scope="col">Provider</th>
                <th scope="col">Entities</th>
                <th scope="col">Unhealthy</th>
              </tr>
            </thead>
            <tbody>
              {summary.byProvider.map((p) => (
                <tr key={p.provider}>
                  <td>{providerLabel(p.provider)}</td>
                  <td className="font-mono">{p.entities}</td>
                  <td className={`font-mono ${p.unhealthy > 0 ? 'text-warn-fg' : 'text-fg-3'}`}>{p.unhealthy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Simulation" aside={<SimulatedTag simulated />}>
          {sim ? (
            <div className="flex flex-col gap-2 text-sm text-fg-2">
              <p className="m-0">
                <span className="font-mono text-fg">{formatClock(sim.clock)}</span> · {running ? 'running' : 'paused'} · {sim.failures.length} active
                simulated {sim.failures.length === 1 ? 'failure' : 'failures'} affecting {sim.impacts.length}{' '}
                {sim.impacts.length === 1 ? 'entity' : 'entities'}
              </p>
              <h3 className={`m-0 mt-1 ${kickerClass}`}>Recent simulated events</h3>
              {sim.events.length === 0 ? (
                <Note>No simulated events yet. Inject a failure from the inspector or the Events & Traffic page.</Note>
              ) : (
                <ol className="m-0 list-none p-0" aria-label="Recent simulated events">
                  {[...sim.events]
                    .reverse()
                    .slice(0, 5)
                    .map((event) => (
                      <li key={event.id} className="flex gap-3 border-t border-line py-1.5 first:border-t-0">
                        <span className="w-[86px] flex-none font-mono text-xs text-fg-3">{formatClock(event.at)}</span>
                        <span className="min-w-0 flex-1">{describeEvent(baselineIndex ?? index, event).title}</span>
                      </li>
                    ))}
                </ol>
              )}
              <button type="button" className={`${buttonClass('secondary')} self-start`} onClick={() => navigate({ pathname: '/events', search })}>
                Open Events & Traffic
              </button>
            </div>
          ) : (
            <Note>The simulation starts when data has loaded.</Note>
          )}
        </Card>
      </div>
    </>
  );
}
