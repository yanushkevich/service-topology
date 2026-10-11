import { createContext, useContext } from 'react';
import { createElkLayoutService } from './elkLayoutService';
import type { GraphLayoutService } from './GraphLayoutService';

/** Injectable so tests and benchmarks can swap the engine; defaults to ELK. */
export const LayoutServiceContext = createContext<GraphLayoutService>(createElkLayoutService());

export function useLayoutService(): GraphLayoutService {
  return useContext(LayoutServiceContext);
}
