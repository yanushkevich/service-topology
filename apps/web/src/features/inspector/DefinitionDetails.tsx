import type { TopologyIndex } from '../../domain/topologyIndex';
import type { ServiceDefinition } from '../../domain/types';
import { protocolLabel, providerLabel, typeLabel } from '../../shared/mappings';
import { StatusShape } from '../../shared/ui/StatusShape';
import { TransitBoardLink } from './InspectorActions';
import { Body, EntityButton, Field, Fields, Header, Metadata, Section, SourceLinkSection } from './InspectorParts';

/** Inspector details of a logical service definition. */
export function DefinitionDetails({ index, definition }: { index: TopologyIndex; definition: ServiceDefinition }) {
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
        <SourceLinkSection metadata={definition.metadata} observable={false} />
        <Metadata metadata={definition.metadata} />
      </Body>
    </>
  );
}
