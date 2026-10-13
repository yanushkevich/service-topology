import type { EndpointRef } from '../../transit/process';
import { useUiStore } from '../../state/uiStore';
import { ContractView } from './ContractView';
import { useEndpointContract } from './useEndpointContract';

/** An endpoint's contract under its process-view arrow (ADR-029). */
export function EndpointContractPanel({ endpoint }: { endpoint: EndpointRef }) {
  const environmentId = useUiStore((s) => s.environmentId);
  const state = useEndpointContract(endpoint.serviceDefinitionId, endpoint.endpoint, environmentId);
  return <ContractView state={state} />;
}
