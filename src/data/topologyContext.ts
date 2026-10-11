import { createContext, useContext } from 'react';
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
    };

export const RepositoryContext = createContext<TopologyRepository>(createMockTopologyRepository());
export const TopologyContext = createContext<TopologyState>({ status: 'loading' });

export function useTopology(): TopologyState {
  return useContext(TopologyContext);
}
