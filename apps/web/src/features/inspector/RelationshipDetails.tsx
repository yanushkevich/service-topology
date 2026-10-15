import { endpointName, kindOfId, type TopologyIndex } from '../../domain/topologyIndex';
import type { CommunicationRelationship, EntityId } from '../../domain/types';
import { formatTimestamp } from '../../shared/format';
import { patternLabel, protocolLabel, relationshipStatusHealth, relationshipStatusLabel } from '../../shared/mappings';
import { StatusShape } from '../../shared/ui/StatusShape';
import { TypeGlyph } from '../../shared/ui/TypeGlyph';
import { Body, EntityButton, Field, Fields, Header, KeyValue, Metadata, MetricsSection, Section, SourceLinkSection } from './InspectorParts';
import { noteOf } from './inspectorText';

/** Inspector details of a communication relationship (connection). */
export function RelationshipDetails({ index, relationship }: { index: TopologyIndex; relationship: CommunicationRelationship }) {
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
        <SourceLinkSection metadata={relationship.metadata} observable={false} />
        <Metadata metadata={relationship.metadata} />
      </Body>
    </>
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
