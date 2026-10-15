import type { ProblemIssue } from '../http/apiClient';

/**
 * A topology source the backend syncs from (ADR-034, docs/DYNATRACE_CONNECTOR.md §6): Dynatrace.
 * The shapes follow docs/api/openapi.json (IntegrationStatus, SourceCheck, SyncPreview).
 */

export type SyncOp = 'create' | 'update' | 'link' | 'keep' | 'delete';
export type SyncKind = 'environment' | 'service-definition' | 'service-instance' | 'resource' | 'relationship';

export interface ObservationMeta {
  source: string;
  observedAt: string;
  isExample: boolean;
  entities: number;
  stale: boolean;
  refreshIntervalSeconds: number;
}

export interface IntegrationStatus {
  source: string;
  isExample: boolean;
  tenants: { id: string; host: string; auth: 'platform-token' | 'oauth'; isExample: boolean }[];
  environments: { id: string; name: string; kind: string; tenant: string; match: string }[];
  refreshIntervalSeconds: number;
  lastSync: { appliedAt: string; revision: string; summary: Partial<Record<SyncKind, Partial<Record<SyncOp, number>>>> } | null;
  lastRefresh: { at: string; ok: boolean; entities: number; error?: string } | null;
  observations: ObservationMeta | null;
  aliasCount: number;
}

export interface SourceCheck {
  tenant: string;
  query: string;
  ok: boolean;
  records: number;
  missingFields?: string[];
  missingScopes?: string[];
  scannedBytes: number;
  durationMs: number;
  message?: string;
}

export interface SyncChange {
  op: SyncOp;
  kind: SyncKind;
  id: string;
  name: string;
  usedBy?: string[];
}

export interface SyncNote {
  code: 'service-without-environment' | 'duplicate-service' | 'cross-environment-call' | 'truncated-result';
  message: string;
  ids?: string[];
}

export interface SyncPreview {
  id: string;
  source: string;
  baseRevision: string;
  createdAt: string;
  expiresAt: string;
  discoveredAt: string;
  isExample: boolean;
  summary: Partial<Record<SyncKind, Partial<Record<SyncOp, number>>>>;
  changes: SyncChange[];
  notes: SyncNote[];
  issues: ProblemIssue[];
  canApply: boolean;
}

export interface Aliases {
  /** Dynatrace service name → service definition ID. */
  aliases: Record<string, string>;
  /** The list's revision (its ETag), for the next save. */
  revision: string | null;
}

export interface SourceIntegration {
  /** The connection, or null when the backend has no Dynatrace configuration. */
  status(signal?: AbortSignal): Promise<IntegrationStatus | null>;
  check(): Promise<SourceCheck[]>;
  preview(): Promise<SyncPreview>;
  /** Applies a preview; resolves with the new topology revision. */
  apply(preview: SyncPreview): Promise<string>;
  aliases(signal?: AbortSignal): Promise<Aliases>;
  saveAliases(aliases: Record<string, string>, revision: string | null): Promise<Aliases>;
}
