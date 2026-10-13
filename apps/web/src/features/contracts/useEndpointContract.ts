import { findContract, parseHttpEndpoint, type Contract } from '../../contracts/openapi';
import { GROUP_LABELS, lineNamed } from '../../transit/board';
import { useRepositoryRead } from '../transit-board/useTransitBoard';

/** What the UI can say about an endpoint's contract (ADR-029). */
export type EndpointContract =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'contract'; contract: Contract; file: string; isExample: boolean }
  /** HTTP, but the service's document has no such operation (or there is no document). */
  | { status: 'missing'; reason: string }
  /** Not an HTTP operation: what it is, where its contract would come from. */
  | { status: 'not-http'; kind: string };

/**
 * The OpenAPI contract of an endpoint ("POST /v1/orders") of a service. Other endpoints are
 * described from the service board when it knows them ("gRPC, declared in payments.proto").
 */
export function useEndpointContract(serviceDefinitionId: string, endpoint: string | undefined, environmentId: string): EndpointContract {
  const http = parseHttpEndpoint(endpoint) !== null;
  const doc = useRepositoryRead(http ? `openapi\u0000${serviceDefinitionId}` : null, (r, signal) => r.getOpenApi(serviceDefinitionId, signal));
  const board = useRepositoryRead(!http && endpoint ? `board\u0000${serviceDefinitionId}\u0000${environmentId}` : null, (r, signal) => r.getBoard(serviceDefinitionId, environmentId, '24h', signal));
  if (!endpoint) return { status: 'not-http', kind: 'This step names no entry point' };
  if (!http) {
    if (board.status !== 'ready') return board.status === 'error' ? { status: 'not-http', kind: 'Not an HTTP operation' } : { status: 'loading' };
    const line = board.value ? lineNamed(board.value.lines, endpoint) : null;
    return { status: 'not-http', kind: line ? `${GROUP_LABELS[line.group]}${line.provenance.entry.kind === 'declared' ? `, declared in ${line.provenance.entry.detail}` : ''}` : 'Not an HTTP operation' };
  }
  if (doc.status === 'loading') return { status: 'loading' };
  if (doc.status === 'error') return { status: 'error', message: doc.message };
  if (!doc.value) return { status: 'missing', reason: 'No OpenAPI document is known for this service.' };
  const contract = findContract(doc.value.doc, endpoint);
  return contract ? { status: 'contract', contract, file: doc.value.file, isExample: doc.value.isExample } : { status: 'missing', reason: `${doc.value.file} has no operation ${endpoint}.` };
}
