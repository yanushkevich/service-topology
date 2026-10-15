import { Link, useLocation } from 'react-router';
import { endpointName, environmentOf, type TopologyIndex } from '../../domain/topologyIndex';
import type { EntityId, InfrastructureResource } from '../../domain/types';
import { providerLabel, typeLabel } from '../../shared/mappings';
import { StatusShape } from '../../shared/ui/StatusShape';
import { TypeGlyph } from '../../shared/ui/TypeGlyph';
import { EnvironmentNotice, MapActions, SimulationSection } from './InspectorActions';
import { Body, ContainmentPath, EntityButton, Field, Fields, Header, Metadata, MetricsSection, Relationships, Section, SourceLinkSection } from './InspectorParts';
import { noteOf } from './inspectorText';

/** Inspector details of an infrastructure resource, including the event types a channel carries. */
export function ResourceDetails({ index, resource }: { index: TopologyIndex; resource: InfrastructureResource }) {
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
        <SourceLinkSection metadata={resource.metadata} observable={true} />
        <Metadata metadata={resource.metadata} />
      </Body>
    </>
  );
}

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
