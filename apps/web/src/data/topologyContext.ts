import { createContext, useContext } from 'react';
import type { SnapshotSummary } from '../domain/snapshot';
import type { TopologyIndex } from '../domain/topologyIndex';
import type { ValidationIssue } from '../domain/validation';
import type { TopologyData } from '../domain/types';
import type { TopologyRepository, TopologyWriter } from './repositories/TopologyRepository';
import { createMockTopologyRepository } from './repositories/mockTopologyRepository';
import type { SandboxControls } from './sandbox/sandbox';
import type { BundleImporter } from './bundle/bundle';
import type { SourceIntegration } from './integrations/sourceIntegration';

export type TopologyState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      index: TopologyIndex;
      issues: readonly ValidationIssue[];
      sourceLabel: string;
      isMock: boolean;
      /**
       * History browsing: null = current state (simulation applied); `ready` = the index shows this
       * snapshot, read-only; `missing` = the requested snapshot does not exist (current state shown).
       */
      history: null | { status: 'ready'; summary: SnapshotSummary } | { status: 'missing'; id: string };
    };

export const RepositoryContext = createContext<TopologyRepository>(createMockTopologyRepository());
export const TopologyContext = createContext<TopologyState>({ status: 'loading' });

export function useTopology(): TopologyState {
  return useContext(TopologyContext);
}

/** Editing the stored topology (ADR-020). */
export interface TopologyEditing {
  /** null when the source cannot be edited (built-in mock data). */
  writer: TopologyWriter | null;
  /** The topology as stored (before the browser simulation changes it); edits start from it. */
  baseline: TopologyData | null;
  /** Reloads from the repository; resolves once the new data is shown (the simulation restarts from it). */
  reload(): Promise<void>;
  /** The local sandbox's controls when edits stay in this browser (ADR-031); null otherwise. */
  sandbox: SandboxControls | null;
  /** Replaces all data with a data bundle (ADR-032); null for generated datasets. */
  importer: BundleImporter | null;
}

export const TopologyEditingContext = createContext<TopologyEditing>({ writer: null, baseline: null, reload: async () => {}, sandbox: null, importer: null });

export function useTopologyEditing(): TopologyEditing {
  return useContext(TopologyEditingContext);
}

/** The backend's Dynatrace connector (ADR-034); null with built-in or generated data. */
export function useSourceIntegration(): SourceIntegration | null {
  return useContext(RepositoryContext).integration ?? null;
}
