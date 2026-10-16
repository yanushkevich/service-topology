/**
 * An entity's link to a topology source (ADR-034, docs/DYNATRACE_CONNECTOR.md): the backend keeps
 * it in `metadata.dynatrace` — the Dynatrace IDs, and while observations are fresh the open Davis
 * problems and when they were observed; `missingSince` when Dynatrace stopped seeing the entity
 * but authored data still uses it. Pure: reads metadata, tolerates any shape.
 */

/** The metadata key of the Dynatrace link. */
export const DYNATRACE_LINK_KEY = 'dynatrace';

export interface SourceLink {
  tenant: string | null;
  /** The Smartscape ID (e.g. SERVICE-30E45F0274EFB653); null on a definition. */
  id: string | null;
  /** The Dynatrace service name (definitions). */
  name: string | null;
  /** When health and metrics were observed; null without a fresh observation. */
  observedAt: string | null;
  /** Open Davis problems (display IDs). */
  problems: string[];
  /** When Dynatrace stopped seeing the entity; null while it is seen. */
  missingSince: string | null;
  /** A topic or queue: its messaging system (kafka, rabbitmq, …) and destination name. */
  messaging: { system: string; destination: string } | null;
  /** The Kubernetes workload a service instance runs as (the instance is the workload, ADR-008). */
  workload: { name: string; kind: string } | null;
}

function workloadOf(raw: unknown): SourceLink['workload'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const w = raw as Record<string, unknown>;
  const name = text(w.name);
  return name ? { name, kind: text(w.kind) ?? 'workload' } : null;
}

const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

export function sourceLinkOf(metadata: Record<string, unknown> | undefined): SourceLink | null {
  const raw = metadata?.[DYNATRACE_LINK_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const link = raw as Record<string, unknown>;
  return {
    tenant: text(link.tenant),
    id: text(link.id),
    name: text(link.name),
    observedAt: text(link.observedAt),
    problems: Array.isArray(link.problems) ? link.problems.filter((p): p is string => typeof p === 'string') : [],
    missingSince: text(link.missingSince),
    messaging: text(link.destination) ? { system: text(link.system) ?? 'unknown system', destination: text(link.destination) ?? '' } : null,
    workload: workloadOf(link.workload),
  };
}
