import type { TopologyIndex } from '../../domain/topologyIndex';
import type { ServiceInstance } from '../../domain/types';
import { formatTimestamp } from '../../shared/format';
import { protocolLabel, providerLabel, typeLabel } from '../../shared/mappings';
import { StatusShape } from '../../shared/ui/StatusShape';
import { EnvironmentNotice, MapActions, SimulationSection, TransitBoardLink } from './InspectorActions';
import { Body, ContainmentPath, EntityButton, Field, Fields, Header, KeyValue, Metadata, MetricsSection, Relationships, Section } from './InspectorParts';
import { noteOf } from './inspectorText';

/** Inspector details of a service instance. */
export function InstanceDetails({ index, instance }: { index: TopologyIndex; instance: ServiceInstance }) {
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
