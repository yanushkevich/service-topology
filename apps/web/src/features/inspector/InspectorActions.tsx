import { Link, useLocation, useNavigate } from 'react-router';
import { useTopology } from '../../data/topologyContext';
import { endpointName, environmentOf, type TopologyIndex } from '../../domain/topologyIndex';
import type { EntityId, EntityRef } from '../../domain/types';
import { healthLabel, patternLabel, protocolLabel } from '../../shared/mappings';
import { Icon } from '../../shared/ui/Icon';
import { SimulatedTag } from '../../shared/ui/DataSourceTag';
import { useSimulationStore } from '../../state/simulationStore';
import { useUiStore } from '../../state/uiStore';
import { PROPAGATION_RULES } from '../../domain/propagation';
import { formatClock } from '../../shared/format';
import { useFlowImpacts } from '../../state/useFlowImpacts';
import { AffectedFlowsList } from '../business-flows/FlowImpactPanels';

/** Actions and notices in the inspector: map and 3D actions, transit board link, simulation, environment notice. */
export function SimulationSection({ index, entityId }: { index: TopologyIndex; entityId: EntityId }) {
  const topology = useTopology();
  const sim = useSimulationStore((s) => s.sim);
  const select = useUiStore((s) => s.select);
  if (!sim || (topology.status === 'ready' && topology.history)) return null;
  const failure = sim.failures.find((f) => f.entityId === entityId);
  const impact = sim.impacts.find((i) => i.entityId === entityId);
  const affects = sim.impacts.filter((i) => i.rootId === entityId).length;
  const { inject, recover } = useSimulationStore.getState();
  const refFor = (id: EntityId): EntityRef => ({ kind: index.instances.has(id) ? 'service-instance' : 'resource', id });
  const via = impact?.viaRelationshipId ? index.relationships.get(impact.viaRelationshipId) : undefined;
  const rule = impact ? PROPAGATION_RULES.find((r) => r.id === impact.ruleId) : undefined;

  return (
    <section className="mb-3 rounded-[9px] border border-dashed border-warn px-[11px] py-[9px]" aria-label="Simulation">
      <h3 className="m-0 mb-1.5 flex items-center justify-between gap-2 text-[10px] font-normal tracking-[0.08em] text-fg-3 uppercase">
        <span>Simulation</span>
        <SimulatedTag simulated />
      </h3>
      {failure && (
        <p className="m-0 mb-2 text-sm text-fg-2 [&_b]:text-fg">
          Simulated <b>{failure.mode}</b> failure since tick {failure.injectedTick}
          {failure.recoverAtTick !== undefined ? `, auto-recovers at tick ${failure.recoverAtTick}` : ''}. Affects {affects}{' '}
          {affects === 1 ? 'entity' : 'entities'}.
        </p>
      )}
      {impact && (
        <p className="m-0 mb-2 text-sm text-fg-2 [&_b]:text-fg">
          <b>{healthLabel(impact.effect)}</b> because{' '}
          <button type="button" className="font-semibold text-fg underline" onClick={() => select(refFor(impact.causeId))}>
            {endpointName(index, impact.causeId)}
          </button>{' '}
          failed{via ? ` (${protocolLabel(via.protocol)}, ${patternLabel(via.pattern).toLowerCase()})` : ' (contains it)'}. Rule:{' '}
          {rule?.title ?? impact.ruleId}.
          {impact.rootId !== impact.causeId && (
            <>
              {' '}
              Root failure:{' '}
              <button type="button" className="font-semibold text-fg underline" onClick={() => select(refFor(impact.rootId))}>
                {endpointName(index, impact.rootId)}
              </button>
              .
            </>
          )}
        </p>
      )}
      {!failure && !impact && <p className="m-0 mb-2 text-sm text-fg-2 [&_b]:text-fg">Not affected by simulated failures at {formatClock(sim.clock)}.</p>}
      <FlowsAffected index={index} entityId={entityId} />
      <div className="mb-3 flex flex-wrap gap-2">
        {failure ? (
          <button type="button" className="inline-flex h-7 items-center gap-[7px] rounded-md border border-line-strong px-3 whitespace-nowrap text-fg hover:bg-surface-3" onClick={() => recover(entityId)}>
            Recover
          </button>
        ) : (
          <>
            <button type="button" className="h-7 rounded-md border border-crit px-3 font-semibold whitespace-nowrap text-crit-fg hover:bg-crit/10" onClick={() => inject(entityId, 'unavailable')}>
              Simulate outage
            </button>
            <button type="button" className="inline-flex h-7 items-center gap-[7px] rounded-md border border-line-strong px-3 whitespace-nowrap text-fg hover:bg-surface-3" onClick={() => inject(entityId, 'degraded')}>
              Simulate degradation
            </button>
          </>
        )}
      </div>
    </section>
  );
}

/** Business flows whose simulated impact runs through this entity (ADR-025): its failure, or one it carries. */
function FlowsAffected({ index, entityId }: { index: TopologyIndex; entityId: EntityId }) {
  const environmentId = useUiStore((s) => s.environmentId);
  const { flows, failures } = useFlowImpacts(index, environmentOf(index, entityId) ?? environmentId);
  const through = flows.filter((f) => f.steps.some((s) => s.path.includes(entityId)));
  if (through.length === 0) return null;
  return (
    <div className="mb-2">
      <h4 className="m-0 mb-1 text-[10px] font-normal tracking-[0.08em] text-fg-3 uppercase">Business flows affected</h4>
      <AffectedFlowsList index={index} impacts={through} failures={failures} label="Business flows affected" />
    </div>
  );
}

/** Registry-to-map focus and neighborhood exploration for the selected entity. */

export function TransitBoardLink({ serviceDefinitionId, environmentId }: { serviceDefinitionId: EntityId; environmentId?: EntityId }) {
  const location = useLocation();
  const setEnvironmentId = useUiStore((s) => s.setEnvironmentId);
  const pathname = `/services/${encodeURIComponent(serviceDefinitionId)}/transit`;
  if (location.pathname === pathname) return null;
  return (
    <Link
      to={{ pathname, search: location.search }}
      onClick={() => environmentId && setEnvironmentId(environmentId)}
      className="mb-3 inline-flex h-7 items-center gap-[7px] rounded-md border border-line-strong px-3 whitespace-nowrap text-fg hover:bg-surface-3"
    >
      <Icon name="dependencies" />
      Open transit board
    </Link>
  );
}

export function MapActions({ entityId }: { entityId: EntityId }) {
  const navigate = useNavigate();
  const location = useLocation();
  const neighborhood = useUiStore((s) => s.neighborhood);
  const setNeighborhood = useUiStore((s) => s.setNeighborhood);
  const setActiveView = useUiStore((s) => s.setActiveView);
  const onMap = location.pathname === '/map';
  const toMap = () => {
    setActiveView('2d');
    if (!onMap) navigate({ pathname: '/map', search: location.search });
  };
  const exploring = neighborhood?.centerId === entityId;
  const enterScope = useUiStore((s) => s.enterScope);
  const exitScopeTo = useUiStore((s) => s.exitScopeTo);
  const activeView = useUiStore((s) => s.activeView);
  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {!(onMap && activeView === '3d') && (
        <button
          type="button"
          className="inline-flex h-7 items-center gap-[7px] rounded-md border border-line-strong px-3 whitespace-nowrap text-fg hover:bg-surface-3"
          onClick={() => {
            exitScopeTo(0);
            enterScope(entityId);
            setActiveView('3d');
            if (!onMap) navigate({ pathname: '/map', search: location.search });
          }}
        >
          <Icon name="view3d" />
          Explore in 3D
        </button>
      )}
      {!onMap && (
        <button type="button" className="inline-flex h-7.5 items-center gap-[7px] rounded-md bg-accent px-3 font-semibold text-on-accent hover:brightness-110" onClick={toMap}>
          <Icon name="focus" />
          Show on map
        </button>
      )}
      <button
        type="button"
        className={exploring ? 'inline-flex h-7 items-center gap-[7px] rounded-md border border-line-strong px-3 whitespace-nowrap text-fg hover:bg-surface-3' : onMap ? 'inline-flex h-7.5 items-center gap-[7px] rounded-md bg-accent px-3 font-semibold text-on-accent hover:brightness-110' : 'inline-flex h-7 items-center gap-[7px] rounded-md border border-line-strong px-3 whitespace-nowrap text-fg hover:bg-surface-3'}
        aria-pressed={exploring}
        onClick={() => {
          setNeighborhood(exploring ? null : { centerId: entityId, depth: neighborhood?.depth ?? 1 });
          if (!exploring) toMap();
        }}
      >
        <Icon name="map" />
        {exploring ? 'Show whole map' : 'Explore neighborhood'}
      </button>
    </div>
  );
}

export function EnvironmentNotice({ index, entityId }: { index: TopologyIndex; entityId: EntityId }) {
  const environmentId = useUiStore((s) => s.environmentId);
  const setEnvironmentId = useUiStore((s) => s.setEnvironmentId);
  const entityEnvironment = environmentOf(index, entityId);
  if (entityEnvironment === undefined || entityEnvironment === environmentId) return null;
  const name = index.environments.get(entityEnvironment)?.name ?? entityEnvironment;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[9px] border border-dashed border-line-strong px-[11px] py-[9px] text-sm text-fg-2" role="status">
      <span>
        This belongs to <b>{name}</b>, not the current environment.
      </span>
      <button type="button" className="inline-flex h-7 items-center gap-[7px] rounded-md border border-line-strong px-3 whitespace-nowrap text-fg hover:bg-surface-3" onClick={() => setEnvironmentId(entityEnvironment)}>
        Switch to {name}
      </button>
    </div>
  );
}
