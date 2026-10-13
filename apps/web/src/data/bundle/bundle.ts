import { buildTopologyIndex } from '../../domain/topologyIndex';
import type { TopologyData } from '../../domain/types';
import { validateTopology } from '../../domain/validation';
import { validateBoardDefinition, type BoardDefinition } from '../../transit/definition';

/**
 * The data bundle (ADR-032, docs/DATA_BUNDLE.md): every data module in one file, for export and
 * import. Topology modules are exactly TopologyData; boards are board definitions. Pure; the
 * validation codes and paths are shared with backend/internal/domain/bundle.go.
 */

export const BUNDLE_FORMAT = 'service-topology.bundle';
export const BUNDLE_VERSION = 1;

export interface DataBundle extends TopologyData {
  format: typeof BUNDLE_FORMAT;
  version: typeof BUNDLE_VERSION;
  exportedAt: string;
  source: { label: string; isMock: boolean };
  transitBoards: BoardDefinition[];
}

/** The modules of a bundle in file order, with the labels the UI shows. */
export const BUNDLE_MODULES = [
  { key: 'environments', label: 'Environments', required: true },
  { key: 'serviceDefinitions', label: 'Services', required: true },
  { key: 'serviceInstances', label: 'Service instances', required: true },
  { key: 'resources', label: 'Infrastructure', required: true },
  { key: 'relationships', label: 'Relationships', required: true },
  { key: 'eventTypes', label: 'Event types', required: false },
  { key: 'businessFlows', label: 'Business flows', required: false },
  { key: 'transitBoards', label: 'Transit boards', required: false },
] as const;

export type BundleModule = (typeof BUNDLE_MODULES)[number]['key'];
export type ModuleCounts = Record<BundleModule, number>;

/** A bundle of the given data, keys in file order (docs/DATA_BUNDLE.md §1). */
export function bundleOf(topology: TopologyData, boards: readonly BoardDefinition[], meta: { exportedAt: string; source: DataBundle['source'] }): DataBundle {
  const bundle: Record<string, unknown> = { format: BUNDLE_FORMAT, version: BUNDLE_VERSION, exportedAt: meta.exportedAt, source: { ...meta.source } };
  for (const { key } of BUNDLE_MODULES) {
    const value = key === 'transitBoards' ? boards : topology[key];
    if (value !== undefined) bundle[key] = structuredClone(value);
  }
  return bundle as unknown as DataBundle;
}

/** The topology part of a bundle (optional modules stay absent when absent). */
export function topologyOf(bundle: DataBundle): TopologyData {
  const out: Record<string, unknown> = {};
  for (const { key } of BUNDLE_MODULES) if (key !== 'transitBoards' && bundle[key] !== undefined) out[key] = bundle[key];
  return out as unknown as TopologyData;
}

export function countsOf(data: Partial<Record<BundleModule, readonly unknown[] | undefined>>): ModuleCounts {
  return Object.fromEntries(BUNDLE_MODULES.map(({ key }) => [key, data[key]?.length ?? 0])) as ModuleCounts;
}

// ---------------------------------------------------------------------------------------------
// Validation (docs/DATA_BUNDLE.md §4)
// ---------------------------------------------------------------------------------------------

export interface BundleIssue {
  code: string;
  /** Field path in the bundle ('format', 'transitBoards[0].lines[1].code'); empty for topology rules. */
  path: string;
  /** The entity a topology rule is about. */
  entityId?: string | undefined;
  message: string;
}

/**
 * Blocking issues of a parsed file, in order: format and version, module shapes (both stop the
 * check), topology errors, duplicate boards, then each board against the bundle's topology.
 */
export function validateBundle(value: unknown): BundleIssue[] {
  if (!isRecord(value)) return [{ code: 'bundle-unreadable', path: '', message: 'The file is not a JSON or YAML object.' }];
  const out: BundleIssue[] = [];
  if (value.format !== BUNDLE_FORMAT) out.push({ code: 'bundle-unsupported', path: 'format', message: `This is not a data bundle: “format” must be “${BUNDLE_FORMAT}”.` });
  else if (value.version !== BUNDLE_VERSION) out.push({ code: 'bundle-unsupported', path: 'version', message: `Bundle version ${String(value.version)} is not supported; this app reads version ${BUNDLE_VERSION}.` });
  if (out.length) return out;

  for (const { key, label, required } of BUNDLE_MODULES) {
    const module = value[key];
    if (module === undefined ? required : !Array.isArray(module)) {
      out.push({ code: 'bundle-invalid-module', path: key, message: module === undefined ? `${label} (“${key}”) are missing.` : `${label} (“${key}”) must be a list.` });
      continue;
    }
    ((module ?? []) as unknown[]).forEach((item, i) => {
      if (!(key === 'transitBoards' ? isBoardShaped(item) : isRecord(item) && typeof item.id === 'string' && item.id !== '')) {
        out.push({ code: 'bundle-invalid-module', path: `${key}[${i}]`, message: key === 'transitBoards' ? `Transit board ${i + 1} needs a “serviceDefinitionId” and lists of stations, lines, policies, and tables.` : `${label}: entry ${i + 1} must be an object with an “id”.` });
      }
    });
  }
  if (out.length) return out;

  const bundle = value as unknown as DataBundle;
  const topology = topologyOf(bundle);
  for (const issue of validateTopology(topology)) {
    if (issue.severity === 'error') out.push({ code: issue.code, path: '', entityId: issue.entityId, message: issue.message });
  }
  const boards = bundle.transitBoards ?? [];
  const seen = new Set<string>();
  boards.forEach((board, i) => {
    if (seen.has(board.serviceDefinitionId)) out.push({ code: 'bundle-duplicate-board', path: `transitBoards[${i}].serviceDefinitionId`, message: `Two transit boards for “${board.serviceDefinitionId}”.` });
    seen.add(board.serviceDefinitionId);
  });
  const index = buildTopologyIndex(topology);
  boards.forEach((board, i) => {
    for (const issue of validateBoardDefinition(board, index)) out.push({ code: issue.code, path: `transitBoards[${i}].${issue.path}`, message: issue.message });
  });
  return out;
}

function isBoardShaped(value: unknown): boolean {
  return isRecord(value) && typeof value.serviceDefinitionId === 'string' && ['stations', 'lines', 'policies', 'tables'].every((k) => Array.isArray(value[k]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
