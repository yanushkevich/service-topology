import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useTopology } from '../../data/topologyContext';
import {
  endpointName,
  environmentOf,
  displayName,
  kindOfId,
  refExists,
  resourceAncestors,
  type TopologyIndex,
} from '../../domain/topologyIndex';
import type {
  CommunicationRelationship,
  EntityId,
  EntityRef,
  HealthStatus,
  InfrastructureResource,
  Metrics,
  ServiceDefinition,
  ServiceInstance,
} from '../../domain/types';
import { formatMetadataValue, formatNumber, formatTimestamp } from '../../shared/format';
import {
  healthLabel,
  patternLabel,
  protocolLabel,
  providerLabel,
  relationshipStatusHealth,
  relationshipStatusLabel,
  typeLabel,
} from '../../shared/mappings';
import { Icon } from '../../shared/ui/Icon';
import { LoadState } from '../../shared/ui/LoadState';
import { SimulatedTag } from '../../shared/ui/DataSourceTag';
import { StatusShape } from '../../shared/ui/StatusShape';
import { TypeGlyph } from '../../shared/ui/TypeGlyph';
import { useSimulationStore } from '../../state/simulationStore';
import { useUiStore } from '../../state/uiStore';
import { PROPAGATION_RULES } from '../../domain/propagation';
import { formatClock } from '../../shared/format';
import { EntityEditActions } from '../editing/EditingControls';

/** Details for the shared selection, resolved from canonical data. Used by every view. */
export function InspectorPanel() {
  const topology = useTopology();
  const selection = useUiStore((s) => s.selection);

  let content: ReactNode;
  if (topology.status !== 'ready') {
    content = (
      <div className="px-3.5">
        <LoadState state={topology} />
      </div>
    );
  } else if (!selection) {
    content = (
      <div className="m-auto px-6.5 py-5.5 text-center">
        <h2 className="m-0 mb-1.5 text-lg font-semibold">Nothing selected</h2>
        <p className="m-0 mb-3 text-fg-2">
          Select a service, resource, or connection on the map or in the registry to see its details here.
        </p>
      </div>
    );
  } else {
    content = <EntityDetails index={topology.index} selection={selection} />;
  }
  const label = topology.status === 'ready' && selection && refExists(topology.index, selection) ? displayName(topology.index, selection.id) : null;

  return (
    <aside className="m-3 ml-0 flex w-[332px] flex-none flex-col overflow-hidden rounded-xl border border-line bg-float shadow-float max-md:m-2 max-md:mt-0 max-md:max-h-[45%] max-md:w-auto" aria-label="Inspector">
      {content}
      {selection && label !== null && (
        <div className="flex-none border-t border-line px-3.5 py-2.5">
          <EntityEditActions kind={selection.kind} id={selection.id} label={label} />
        </div>
      )}
    </aside>
  );
}

function EntityDetails({ index, selection }: { index: TopologyIndex; selection: EntityRef }) {
  const { id } = selection;
  switch (selection.kind) {
    case 'service-instance': {
      const instance = index.instances.get(id);
      if (instance) return <InstanceDetails index={index} instance={instance} />;
      break;
    }
    case 'resource': {
      const resource = index.resources.get(id);
      if (resource) return <ResourceDetails index={index} resource={resource} />;
      break;
    }
    case 'relationship': {
      const relationship = index.relationships.get(id);
      if (relationship) return <RelationshipDetails index={index} relationship={relationship} />;
      break;
    }
    case 'service-definition': {
      const definition = index.definitions.get(id);
      if (definition) return <DefinitionDetails index={index} definition={definition} />;
      break;
    }
    case 'environment': {
      const environment = index.environments.get(id);
      if (environment) {
        return <Header glyph="namespace" name={environment.name} subtitle={`Environment · ${environment.id}`} />;
      }
      break;
    }
  }
  return <MissingSelection selection={selection} />;
}

// ---------------------------------------------------------------------------------------------
// Per-kind details
// ---------------------------------------------------------------------------------------------

function InstanceDetails({ index, instance }: { index: TopologyIndex; instance: ServiceInstance }) {
  const definition = index.definitions.get(instance.serviceDefinitionId);
  const siblings = (index.instancesByDefinition.get(instance.serviceDefinitionId) ?? []).filter(
    (i) => i.id !== instance.id,
  );
  const category = definition?.category ?? 'other';

  return (
    <>
      <Header
        glyph={category}
        name={definition?.name ?? instance.id}
        subtitle={`${typeLabel(category)} · ${instance.id}`}
        health={instance.health}
        note={noteOf(instance.metadata)}
      />
      <Body>
        <MapActions entityId={instance.id} />
        <TransitBoardLink serviceDefinitionId={instance.serviceDefinitionId} environmentId={instance.environmentId} />
        <SimulationSection index={index} entityId={instance.id} />
        <EnvironmentNotice index={index} entityId={instance.id} />
        {definition?.description && <p className="m-0 mb-3 text-fg-2">{definition.description}</p>}
        <Fields>
          <Field label="Environment" mono>
            {index.environments.get(instance.environmentId)?.name ?? instance.environmentId}
          </Field>
          <Field label="Provider">{providerLabel(instance.provider)}</Field>
          <Field label="Owner">{definition?.owner ?? 'Unassigned'}</Field>
          <Field label="Team">{definition?.team ?? 'Unassigned'}</Field>
          <Field label="Version" mono>
            {instance.version ?? '—'}
          </Field>
          <Field label="Updated" mono>
            {formatTimestamp(instance.updatedAt)}
          </Field>
        </Fields>
        {instance.endpoint && <KeyValue label="Endpoint" value={instance.endpoint} />}
        {definition && definition.protocols.length > 0 && (
          <KeyValue label="Protocols" value={definition.protocols.map(protocolLabel).join(', ')} />
        )}

        <Section title="Runs in">
          {instance.resourceId ? (
            <ContainmentPath index={index} resourceId={instance.resourceId} includeSelf />
          ) : (
            <p className="m-0 px-2 py-1 text-sm text-fg-3">Hosting resource not modeled.</p>
          )}
        </Section>

        <MetricsSection metrics={instance.metrics} />
        <Relationships index={index} entityId={instance.id} />

        <Section title="Logical service" count={siblings.length + 1}>
          {definition && (
            <EntityButton target={{ kind: 'service-definition', id: definition.id }}>
              <span className="min-w-0 flex-1 truncate text-[12.5px]">{definition.name}</span>
              <span className={`font-mono text-[10px] whitespace-nowrap text-fg-3`}>definition</span>
            </EntityButton>
          )}
          {siblings.map((sibling) => (
            <EntityButton key={sibling.id} target={{ kind: 'service-instance', id: sibling.id }}>
              <span className="min-w-0 flex-1 truncate text-[12.5px]">
                {index.environments.get(sibling.environmentId)?.name ?? sibling.environmentId}
              </span>
              <span className={`font-mono text-[10px] whitespace-nowrap text-fg-3`}>{sibling.version ?? ''}</span>
              <StatusShape health={sibling.health} />
            </EntityButton>
          ))}
        </Section>

        <Metadata metadata={instance.metadata} />
      </Body>
    </>
  );
}

function ResourceDetails({ index, resource }: { index: TopologyIndex; resource: InfrastructureResource }) {
  const environmentId = environmentOf(index, resource.id);
  const childResources = index.childResources.get(resource.id) ?? [];
  const hostedInstances = index.instancesByResource.get(resource.id) ?? [];
  const inherited = resource.environmentId === undefined && environmentId !== undefined;

  return (
    <>
      <Header
        glyph={resource.type}
        name={resource.name}
        subtitle={`${typeLabel(resource.type)} · ${resource.id}`}
        health={resource.health}
        note={noteOf(resource.metadata)}
      />
      <Body>
        {(index.outgoing.has(resource.id) || index.incoming.has(resource.id)) && <MapActions entityId={resource.id} />}
        <SimulationSection index={index} entityId={resource.id} />
        <EnvironmentNotice index={index} entityId={resource.id} />
        <Fields>
          <Field label="Environment" mono>
            {environmentId
              ? `${index.environments.get(environmentId)?.name ?? environmentId}${inherited ? ' (inherited)' : ''}`
              : 'Any'}
          </Field>
          <Field label="Provider">{providerLabel(resource.provider)}</Field>
          <Field label="Owner">{resource.owner ?? '—'}</Field>
          <Field label="Team">{resource.team ?? '—'}</Field>
        </Fields>

        <Section title="Contained in">
          {resource.parentResourceId ? (
            <ContainmentPath index={index} resourceId={resource.id} />
          ) : (
            <p className="m-0 px-2 py-1 text-sm text-fg-3">Top-level resource.</p>
          )}
        </Section>

        {(childResources.length > 0 || hostedInstances.length > 0) && (
          <Section title="Contains" count={childResources.length + hostedInstances.length}>
            {childResources.map((child) => (
              <EntityButton key={child.id} target={{ kind: 'resource', id: child.id }}>
                <TypeGlyph type={child.type} size={13} />
                <span className="min-w-0 flex-1 truncate text-[12.5px]">{child.name}</span>
                <span className={`font-mono text-[10px] whitespace-nowrap text-fg-3`}>{typeLabel(child.type)}</span>
                {child.health && <StatusShape health={child.health} />}
              </EntityButton>
            ))}
            {hostedInstances.map((instance) => (
              <EntityButton key={instance.id} target={{ kind: 'service-instance', id: instance.id }}>
                <TypeGlyph type={index.definitions.get(instance.serviceDefinitionId)?.category ?? 'other'} size={13} />
                <span className="min-w-0 flex-1 truncate text-[12.5px]">{endpointName(index, instance.id)}</span>
                <span className={`font-mono text-[10px] whitespace-nowrap text-fg-3`}>instance</span>
                <StatusShape health={instance.health} />
              </EntityButton>
            ))}
          </Section>
        )}

        <EventsCarried index={index} channelId={resource.id} />
        <MetricsSection metrics={resource.metrics} />
        <Relationships index={index} entityId={resource.id} />
        <Metadata metadata={resource.metadata} />
      </Body>
    </>
  );
}

function RelationshipDetails({ index, relationship }: { index: TopologyIndex; relationship: CommunicationRelationship }) {
  const arrow = relationship.direction === 'bidirectional' ? '↔' : '→';
  const name = `${endpointName(index, relationship.sourceEntityId)} ${arrow} ${endpointName(index, relationship.targetEntityId)}`;

  return (
    <>
      <Header
        glyph="connection"
        name={name}
        subtitle={`${protocolLabel(relationship.protocol)} connection · ${relationship.id}`}
        health={relationshipStatusHealth(relationship.status)}
        healthText={relationshipStatusLabel(relationship.status)}
        note={noteOf(relationship.metadata)}
      />
      <Body>
        <Section title="Endpoints">
          <EndpointButton index={index} id={relationship.sourceEntityId} role="Source" />
          <EndpointButton index={index} id={relationship.targetEntityId} role="Target" />
        </Section>
        <Fields>
          <Field label="Protocol">{protocolLabel(relationship.protocol)}</Field>
          <Field label="Pattern">{patternLabel(relationship.pattern)}</Field>
          <Field label="Direction">{relationship.direction === 'bidirectional' ? 'Bidirectional' : 'One-way'}</Field>
          <Field label="Status">{relationshipStatusLabel(relationship.status)}</Field>
          <Field label="Authentication">{relationship.authenticationType ?? '—'}</Field>
          <Field label="Last activity" mono>
            {formatTimestamp(relationship.metrics?.observedAt ?? relationship.updatedAt)}
          </Field>
        </Fields>
        {relationship.endpoint && <KeyValue label="Endpoint" value={relationship.endpoint} />}
        <MetricsSection metrics={relationship.metrics} />
        <Metadata metadata={relationship.metadata} />
      </Body>
    </>
  );
}

function DefinitionDetails({ index, definition }: { index: TopologyIndex; definition: ServiceDefinition }) {
  const instances = index.instancesByDefinition.get(definition.id) ?? [];
  return (
    <>
      <Header
        glyph={definition.category}
        name={definition.name}
        subtitle={`Logical service · ${definition.id}`}
      />
      <Body>
        {definition.description && <p className="m-0 mb-3 text-fg-2">{definition.description}</p>}
        <TransitBoardLink serviceDefinitionId={definition.id} />
        <Fields>
          <Field label="Category">{typeLabel(definition.category)}</Field>
          <Field label="Owner">{definition.owner ?? 'Unassigned'}</Field>
          <Field label="Team">{definition.team ?? 'Unassigned'}</Field>
          <Field label="Protocols">{definition.protocols.map(protocolLabel).join(', ') || '—'}</Field>
        </Fields>
        <Section title="Deployed instances" count={instances.length}>
          {instances.length === 0 && <p className="m-0 px-2 py-1 text-sm text-fg-3">Not deployed in any environment.</p>}
          {instances.map((instance) => (
            <EntityButton key={instance.id} target={{ kind: 'service-instance', id: instance.id }}>
              <span className="min-w-0 flex-1 truncate text-[12.5px]">
                {index.environments.get(instance.environmentId)?.name ?? instance.environmentId}
              </span>
              <span className={`font-mono text-[10px] whitespace-nowrap text-fg-3`}>
                {providerLabel(instance.provider)} · {instance.version ?? '—'}
              </span>
              <StatusShape health={instance.health} />
            </EntityButton>
          ))}
        </Section>
        <Metadata metadata={definition.metadata} />
      </Body>
    </>
  );
}

function MissingSelection({ selection }: { selection: EntityRef }) {
  const select = useUiStore((s) => s.select);
  return (
    <div className="m-auto px-6.5 py-5.5 text-center" role="status">
      <h2 className="m-0 mb-1.5 text-lg font-semibold">Selection not found</h2>
      <p className="m-0 mb-3 text-fg-2">
        No {selection.kind.replace('-', ' ')} with ID <span className="font-mono">{selection.id}</span> exists in the
        current data.
      </p>
      <button type="button" className="inline-flex h-7 items-center gap-[7px] rounded-md border border-line-strong px-3 whitespace-nowrap text-fg hover:bg-surface-3" onClick={() => select(null)}>
        Clear selection
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------------------------

function Header({
  glyph,
  name,
  subtitle,
  health,
  healthText,
  note,
}: {
  glyph: string;
  name: string;
  subtitle: string;
  health?: HealthStatus | undefined;
  healthText?: string;
  note?: string | undefined;
}) {
  const select = useUiStore((s) => s.select);
  return (
    <div className="flex-none border-b border-line px-3.5 pt-3.5 pb-3">
      <div className="flex items-start gap-[11px]">
        <span className="grid size-[38px] flex-none place-items-center rounded-lg border border-line bg-surface-3">
          <TypeGlyph type={glyph} size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="m-0 truncate text-lg font-semibold">{name}</h2>
          <div className={`font-mono truncate text-xs text-fg-3`}>{subtitle}</div>
        </div>
        <button type="button" className="grid size-7.5 flex-none place-items-center rounded-md text-fg-2 hover:bg-surface-3 hover:text-fg" onClick={() => select(null)} aria-label="Close inspector">
          <Icon name="close" />
        </button>
      </div>
      {health && (
        <div className="mt-3 flex items-center gap-2 rounded-[9px] bg-surface-3 px-2.5 py-2 text-[12.5px]">
          <StatusShape health={health} />
          <b>{healthText ?? healthLabel(health)}</b>
          {note && <span className="min-w-0 truncate text-sm text-fg-2">{note}</span>}
        </div>
      )}
    </div>
  );
}

function Body({ children }: { children: ReactNode }) {
  return <div className="min-h-0 flex-1 overflow-auto px-3.5 pt-3 pb-4">{children}</div>;
}

function Fields({ children }: { children: ReactNode }) {
  return <dl className="m-0 grid grid-cols-2 gap-2">{children}</dl>;
}

function Field({ label, mono, children }: { label: string; mono?: boolean; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-surface-3/60 px-[11px] py-[9px]">
      <dt className="text-[10px] tracking-[0.07em] text-fg-3 uppercase">{label}</dt>
      <dd className={`m-0 mt-0.5 text-[12.5px] wrap-anywhere ${mono ? 'font-mono' : ''}`}>{children}</dd>
    </div>
  );
}

/** Event types this topic/queue/exchange carries (ADR-014), each linking to the catalog. */
function EventsCarried({ index, channelId }: { index: TopologyIndex; channelId: EntityId }) {
  const { search } = useLocation();
  const events = index.eventTypesByChannel.get(channelId) ?? [];
  if (events.length === 0) return null;
  return (
    <Section title="Events carried" count={events.length}>
      <ul className="m-0 list-none p-0">
        {events.map((e) => (
          <li key={e.id}>
            <Link
              to={{ pathname: `/events/${encodeURIComponent(e.id)}`, search }}
              className="flex min-h-[34px] items-center gap-[9px] rounded-md px-2 text-[12.5px] hover:bg-surface-3"
            >
              <span className="min-w-0 flex-1 truncate font-mono">{e.name}</span>
              {e.schemaVersion && <span className="font-mono text-[10px] text-fg-3">{e.schemaVersion}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="mt-4">
      <h3 className="m-0 mb-1.5 flex items-center justify-between gap-2 text-[10px] font-normal tracking-[0.08em] text-fg-3 uppercase">
        <span>{title}</span>
        {count !== undefined && <span>{count}</span>}
      </h3>
      {children}
    </section>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-line py-1.5 text-sm">
      <span className="text-fg-3">{label}</span>
      <span className={`font-mono min-w-0 text-right wrap-anywhere`}>{value}</span>
    </div>
  );
}

function EntityButton({ target, children }: { target: EntityRef; children: ReactNode }) {
  const select = useUiStore((s) => s.select);
  return (
    <button type="button" className="flex min-h-[34px] w-full items-center gap-[9px] rounded-md px-2 text-left enabled:hover:bg-surface-3" onClick={() => select(target)}>
      {children}
    </button>
  );
}

function EndpointButton({ index, id, role }: { index: TopologyIndex; id: EntityId; role: string }) {
  const kind = kindOfId(index, id);
  if (kind !== 'service-instance' && kind !== 'resource') {
    return <p className="m-0 px-2 py-1 text-sm text-fg-3">{role}: unknown entity {id}</p>;
  }
  const instance = index.instances.get(id);
  const resource = index.resources.get(id);
  const type = instance
    ? (index.definitions.get(instance.serviceDefinitionId)?.category ?? 'other')
    : (resource?.type ?? 'other');
  const health = instance?.health ?? resource?.health;
  return (
    <EntityButton target={{ kind, id }}>
      <TypeGlyph type={type} size={13} />
      <span className="min-w-0 flex-1 truncate text-[12.5px]">{endpointName(index, id)}</span>
      <span className={`font-mono text-[10px] whitespace-nowrap text-fg-3`}>{role}</span>
      {health && <StatusShape health={health} />}
    </EntityButton>
  );
}

function ContainmentPath({
  index,
  resourceId,
  includeSelf = false,
}: {
  index: TopologyIndex;
  resourceId: EntityId;
  includeSelf?: boolean;
}) {
  const self = index.resources.get(resourceId);
  const chain = [...resourceAncestors(index, resourceId), ...(includeSelf && self ? [self] : [])];
  return (
    <ol className="m-0 list-none p-0 [&>li+li]:ml-3 [&>li+li]:border-l [&>li+li]:border-line-strong [&>li+li]:pl-1" aria-label="Containment path">
      {chain.map((resource) => (
        <li key={resource.id}>
          <EntityButton target={{ kind: 'resource', id: resource.id }}>
            <span className="min-w-0 flex-1 truncate text-[12.5px]">{resource.name}</span>
            <span className={`font-mono text-[10px] whitespace-nowrap text-fg-3`}>{typeLabel(resource.type)}</span>
          </EntityButton>
        </li>
      ))}
    </ol>
  );
}

function Relationships({ index, entityId }: { index: TopologyIndex; entityId: EntityId }) {
  const outgoing = index.outgoing.get(entityId) ?? [];
  const incoming = index.incoming.get(entityId) ?? [];
  return (
    <>
      <Section title="Outgoing (calls, publishes to)" count={outgoing.length}>
        {outgoing.length === 0 && <p className="m-0 px-2 py-1 text-sm text-fg-3">No outgoing connections modeled.</p>}
        {outgoing.map((r) => (
          <RelationshipRow key={r.id} index={index} relationship={r} peerId={r.targetEntityId} />
        ))}
      </Section>
      <Section title="Incoming (called by, delivers to)" count={incoming.length}>
        {incoming.length === 0 && <p className="m-0 px-2 py-1 text-sm text-fg-3">No incoming connections modeled.</p>}
        {incoming.map((r) => (
          <RelationshipRow key={r.id} index={index} relationship={r} peerId={r.sourceEntityId} />
        ))}
      </Section>
    </>
  );
}

function RelationshipRow({
  index,
  relationship,
  peerId,
}: {
  index: TopologyIndex;
  relationship: CommunicationRelationship;
  peerId: EntityId;
}) {
  const select = useUiStore((s) => s.select);
  const peerKind = kindOfId(index, peerId);
  const peerName = endpointName(index, peerId);
  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        className="flex min-h-[34px] w-full items-center gap-[9px] rounded-md px-2 text-left enabled:hover:bg-surface-3"
        onClick={() => peerKind && select({ kind: peerKind, id: peerId })}
        disabled={!peerKind}
      >
        <span className="min-w-0 flex-1 truncate text-[12.5px]">{peerName}</span>
        <span className={`font-mono text-[10px] whitespace-nowrap text-fg-3`}>{protocolLabel(relationship.protocol)}</span>
        <StatusShape health={relationshipStatusHealth(relationship.status)} />
      </button>
      <button
        type="button"
        className="grid size-7 flex-none place-items-center rounded-sm text-fg-3 hover:bg-surface-3 hover:text-fg"
        onClick={() => select({ kind: 'relationship', id: relationship.id })}
        aria-label={`Connection details: ${protocolLabel(relationship.protocol)} with ${peerName}`}
        title="Connection details"
      >
        <Icon name="chevronRight" />
      </button>
    </div>
  );
}

function MetricsSection({ metrics }: { metrics: Metrics | undefined }) {
  return (
    <section className="mt-4" aria-label="Telemetry">
      <h3 className="m-0 mb-1.5 flex items-center justify-between gap-2 text-[10px] font-normal tracking-[0.08em] text-fg-3 uppercase">
        <span>Telemetry</span>
        {metrics && <SimulatedTag simulated={metrics.isSimulated} />}
      </h3>
      {metrics ? (
        <>
          <dl className="m-0 mb-1.5 grid grid-cols-3 gap-2">
            <div className="min-w-0 rounded-lg border border-line bg-surface-3/60 px-[11px] py-[9px]">
              <dt className="text-[10px] tracking-[0.07em] text-fg-3 uppercase">Latency</dt>
              <dd className={`m-0 mt-0.5 text-lg font-medium font-mono`}>{formatNumber(metrics.latencyMs, ' ms')}</dd>
            </div>
            <div className="min-w-0 rounded-lg border border-line bg-surface-3/60 px-[11px] py-[9px]">
              <dt className="text-[10px] tracking-[0.07em] text-fg-3 uppercase">Throughput</dt>
              <dd className={`m-0 mt-0.5 text-lg font-medium font-mono`}>{formatNumber(metrics.throughputPerSecond, '/s')}</dd>
            </div>
            <div className="min-w-0 rounded-lg border border-line bg-surface-3/60 px-[11px] py-[9px]">
              <dt className="text-[10px] tracking-[0.07em] text-fg-3 uppercase">Errors</dt>
              <dd className={`m-0 mt-0.5 text-lg font-medium font-mono`}>{formatNumber(metrics.errorRatePercent, '%')}</dd>
            </div>
          </dl>
          <p className="m-0 px-2 py-1 text-sm text-fg-3">
            {metrics.isSimulated ? 'Simulated values, not observed telemetry' : 'Observed'} · as of{' '}
            {formatTimestamp(metrics.observedAt)}
          </p>
        </>
      ) : (
        <p className="m-0 px-2 py-1 text-sm text-fg-3">No telemetry available.</p>
      )}
    </section>
  );
}

function Metadata({ metadata }: { metadata: Record<string, unknown> | undefined }) {
  const entries = Object.entries(metadata ?? {}).filter(([key]) => key !== 'note');
  if (entries.length === 0) return null;
  return (
    <Section title="Metadata">
      {entries.map(([key, value]) => (
        <KeyValue key={key} label={key} value={formatMetadataValue(value)} />
      ))}
    </Section>
  );
}

/**
 * Simulated failure state of the entity: why it is affected (rule + cause), and actions to inject or
 * recover a failure. Hidden while browsing history, which is read-only.
 */
function SimulationSection({ index, entityId }: { index: TopologyIndex; entityId: EntityId }) {
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

/** Registry-to-map focus and neighborhood exploration for the selected entity. */
/**
 * Opens the per-service transit board (ADR-021) for the selected service, in the instance's
 * environment when there is one.
 */
function TransitBoardLink({ serviceDefinitionId, environmentId }: { serviceDefinitionId: EntityId; environmentId?: EntityId }) {
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

function MapActions({ entityId }: { entityId: EntityId }) {
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

/** Warns when the selection belongs to another environment than the one in the header. */
function EnvironmentNotice({ index, entityId }: { index: TopologyIndex; entityId: EntityId }) {
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

function noteOf(metadata: Record<string, unknown> | undefined): string | undefined {
  return typeof metadata?.note === 'string' ? metadata.note : undefined;
}
