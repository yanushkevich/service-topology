import { createContext, useContext } from 'react';
import { mockSnapshots } from '../mock/snapshots';
import { createInMemorySnapshotRepository, type SnapshotRepository } from './SnapshotRepository';

export const SnapshotRepositoryContext = createContext<SnapshotRepository>(createInMemorySnapshotRepository(mockSnapshots()));

export function useSnapshotRepository(): SnapshotRepository {
  return useContext(SnapshotRepositoryContext);
}
