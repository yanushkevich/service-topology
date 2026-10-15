import type { IntegrationStatus, SyncKind, SyncOp, SyncPreview } from '../../data/integrations/sourceIntegration';

/** Wording for the Dynatrace connector's settings (ADR-034, docs/DYNATRACE_CONNECTOR.md). */

export const SYNC_OPS: readonly SyncOp[] = ['create', 'update', 'link', 'keep', 'delete'];
export const SYNC_KINDS: readonly SyncKind[] = ['environment', 'service-definition', 'service-instance', 'resource', 'relationship'];

export const OP_LABELS: Record<SyncOp, string> = {
  create: 'New',
  update: 'Updated',
  link: 'Linked',
  keep: 'Kept, still used',
  delete: 'Removed',
};

/** What each operation means, for the table's caption and the change list. */
export const OP_MEANINGS: Record<SyncOp, string> = {
  create: 'found in Dynatrace and added',
  update: 'added by an earlier sync and changed in Dynatrace',
  link: 'already here; linked to Dynatrace, nothing overwritten',
  keep: 'gone from Dynatrace but used by a flow, event type, relationship, or board; kept and marked',
  delete: 'added by an earlier sync and gone from Dynatrace',
};

export const KIND_LABELS: Record<SyncKind, string> = {
  environment: 'Environments',
  'service-definition': 'Services',
  'service-instance': 'Service instances',
  resource: 'Infrastructure',
  relationship: 'Connections',
};

export const AUTH_LABELS: Record<IntegrationStatus['tenants'][number]['auth'], string> = {
  'platform-token': 'platform token',
  oauth: 'OAuth client',
};

export const clockTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
export const dateTime = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

/** "3 new, 2 linked" for a summary; "no changes" when empty. */
export function summaryText(summary: SyncPreview['summary']): string {
  const totals = SYNC_OPS.map((op) => [op, SYNC_KINDS.reduce((n, kind) => n + (summary[kind]?.[op] ?? 0), 0)] as const).filter(([, n]) => n > 0);
  return totals.length ? totals.map(([op, n]) => `${n} ${OP_LABELS[op].toLowerCase()}`).join(', ') : 'no changes';
}

/** How current the observed health and metrics are. */
export function observationText(status: IntegrationStatus): string {
  const { observations: o, lastRefresh: r } = status;
  const every = `refreshed every ${status.refreshIntervalSeconds} s`;
  if (r && !r.ok) return `The last refresh failed at ${clockTime(r.at)}: ${r.error ?? 'no reason given'}.${o ? ` Showing ${o.stale ? 'nothing (out of date)' : `states from ${clockTime(o.observedAt)}`}.` : ''}`;
  if (!o) return `Not observed yet; ${every}.`;
  if (o.stale) return `Out of date: last observed at ${clockTime(o.observedAt)}, so not shown; ${every}.`;
  return `${o.entities} entities observed at ${clockTime(o.observedAt)}; ${every}.`;
}
