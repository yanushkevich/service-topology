import { createContext, useContext } from 'react';
import type { SnapshotSummary } from '../domain/snapshot';
import type { TopologyIndex } from '../domain/topologyIndex';
import type { ValidationIssue } from '../domain/validation';
import type { TopologyRepository } from './repositories/TopologyRepository';
import { createMockTopologyRepository } from './repositories/mockTopologyRepository';

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
