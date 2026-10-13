import type { TopologyData } from '../../domain/types';
import type { TransitRepository } from '../../transit/repository';
import { bundleOf, type DataBundle } from './bundle';

/**
 * The bundle of what the app shows now (docs/DATA_BUNDLE.md §2): the loaded topology, and the
 * declared structure of every board for a service in it (stored, or the example's).
 */
export async function collectBundle(input: { topology: TopologyData; sourceLabel: string; isMock: boolean; transit: TransitRepository; now: Date }): Promise<DataBundle> {
  const services = new Set(input.topology.serviceDefinitions.map((d) => d.id));
  const boards = (await input.transit.boardDefinitions()).filter((d) => services.has(d.serviceDefinitionId));
  const exportedAt = input.now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  return bundleOf(input.topology, boards, { exportedAt, source: { label: input.sourceLabel, isMock: input.isMock } });
}
