import { createContext, useContext } from 'react';
import { createLocalSavedLayoutRepository, type SavedLayoutRepository } from './SavedLayoutRepository';

export const SavedLayoutRepositoryContext = createContext<SavedLayoutRepository>(createLocalSavedLayoutRepository());

export function useSavedLayoutRepository(): SavedLayoutRepository {
  return useContext(SavedLayoutRepositoryContext);
}
