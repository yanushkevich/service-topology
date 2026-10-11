import { createContext, useContext } from 'react';
import type { GraphGroup } from '../../graph/topologyGraph';

/** Callbacks from custom nodes back to the map view (kept out of node data to keep data serializable). */
export interface MapActions {
  toggleGroup: (groupId: string) => void;
  selectGroup: (group: GraphGroup) => void;
}

export const MapActionsContext = createContext<MapActions>({
  toggleGroup: () => {},
  selectGroup: () => {},
});

export function useMapActions(): MapActions {
  return useContext(MapActionsContext);
}
