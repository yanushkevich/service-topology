import type { ReactNode } from 'react';
import { useTopology } from '../../data/topologyContext';
import { displayName, refExists, type TopologyIndex } from '../../domain/topologyIndex';
import type { EntityRef } from '../../domain/types';
import { LoadState } from '../../shared/ui/LoadState';
import { useUiStore } from '../../state/uiStore';
import { EntityEditActions } from '../editing/EditingControls';
import { DefinitionDetails } from './DefinitionDetails';
import { Header, MissingSelection } from './InspectorParts';
import { InstanceDetails } from './InstanceDetails';
import { RelationshipDetails } from './RelationshipDetails';
import { ResourceDetails } from './ResourceDetails';

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
