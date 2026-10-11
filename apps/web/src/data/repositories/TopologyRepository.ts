import type { TopologyData } from '../../domain/types';

/**
 * Data access boundary. Features depend on this interface, never on mock arrays directly, so a
 * future HTTP adapter (docs/API_CONTRACT.md) can replace the mock without touching UI code.
 */
export interface TopologyRepository {
  /** Human-readable data source label shown in the UI (e.g. to mark mock data). */
  readonly sourceLabel: string;
  /** True when entities and telemetry are generated rather than observed. */
  readonly isMock: boolean;
  getTopology(signal?: AbortSignal): Promise<TopologyData>;
}
