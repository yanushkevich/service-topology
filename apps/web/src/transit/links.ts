import { environmentOf, type TopologyIndex } from '../domain/topologyIndex';
import type { EntityRef, HealthStatus } from '../domain/types';
import type { Finding, Station, TransitBoard } from './types';

/**
 * Links between the service board's dependencies and the canonical topology (ADR-027,
 * docs/BUSINESS_FLOWS.md Revision 3 §14). A dependency names its entity (`entityId`); it is
 * resolved in the board's environment, never matched by name. Pure.
 */

export type DependencyLink =
  | { status: 'linked'; ref: EntityRef; name: string; kind: 'service' | 'resource'; type: string; health: HealthStatus | undefined }
  | { status: 'not-in-topology' }
  | { status: 'not-in-environment'; entityId: string };

/** Every dependency station's link, by station ID. */
export function linkDependencies(board: TransitBoard, index: TopologyIndex, environmentId: string): Map<string, DependencyLink> {
  const out = new Map<string, DependencyLink>();
  for (const station of board.stations) {
    if (station.kind === 'dependency') out.set(station.id, linkOf(station, index, environmentId));
  }
  return out;
}

function linkOf(station: Station, index: TopologyIndex, environmentId: string): DependencyLink {
  const id = station.entityId;
  if (!id) return { status: 'not-in-topology' };
  const definition = index.definitions.get(id);
  if (definition) {
    const instance = (index.instancesByDefinition.get(id) ?? []).find((i) => i.environmentId === environmentId);
    if (!instance) return { status: 'not-in-environment', entityId: id };
    return { status: 'linked', ref: { kind: 'service-instance', id: instance.id }, name: definition.name, kind: 'service', type: definition.category, health: instance.health };
  }
  const resource = index.resources.get(id);
  if (!resource) return { status: 'not-in-topology' };
  // A resource outside any environment (an external API) is shared by all of them.
  const home = environmentOf(index, id);
  if (home !== undefined && home !== environmentId) return { status: 'not-in-environment', entityId: id };
  return { status: 'linked', ref: { kind: 'resource', id }, name: resource.name, kind: 'resource', type: resource.type, health: resource.health };
}

const STATUS: Record<HealthStatus, Station['status']> = { healthy: 'ok', degraded: 'degraded', unavailable: 'down', unknown: undefined };

/**
 * The board with the topology applied: linked dependencies take their name and health from the
 * topology (which includes a running simulation), and every line gets a finding for each dependency on its
 * route that the topology does not have.
 */
export function applyLinks(board: TransitBoard, links: ReadonlyMap<string, DependencyLink>): TransitBoard {
  const stations = board.stations.map((s) => {
    const link = links.get(s.id);
    if (link?.status !== 'linked') return s;
    // The topology names the dependency and owns its health; example health is dropped.
    const next: Station = { ...s, name: link.name };
    delete next.status;
    const status = link.health ? STATUS[link.health] : undefined;
    return status ? { ...next, status } : next;
  });
  const byId = new Map(board.stations.map((s) => [s.id, s]));
  const lines = board.lines.map((line) => {
    const missing = [...new Set(line.route.flatMap((b) => b.stations))].filter((id) => {
      const status = links.get(id)?.status;
      return status === 'not-in-topology' || status === 'not-in-environment';
    });
    if (missing.length === 0) return line;
    const findings: Finding[] = missing.map((id) => ({
      severity: 'info',
      ruleId: 'dependency-not-in-topology',
      text: `${byId.get(id)?.name ?? id} is not in the topology${links.get(id)?.status === 'not-in-environment' ? ' for this environment' : ''}: its health and impact cannot be shown.`,
      stationIds: [id],
      fix: 'Model it in the topology and link the station to it (entityId).',
    }));
    return { ...line, findings: [...line.findings, ...findings] };
  });
  return { ...board, stations, lines };
}

/** A key that changes only when a link or a linked health changes (for memoizing applyLinks). */
export function linksKey(links: ReadonlyMap<string, DependencyLink>): string {
  return [...links].map(([id, l]) => `${id}=${l.status === 'linked' ? `${l.ref.id}:${l.health ?? ''}` : l.status}`).join('|');
}
