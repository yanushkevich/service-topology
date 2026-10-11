import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router';
import { decodeUrlState, encodeUrlState, type TopologyUrlState } from './urlState';
import { useUiStore } from './uiStore';

type UiState = ReturnType<typeof useUiStore.getState>;

function fromStore(state: UiState): TopologyUrlState {
  return {
    environmentId: state.environmentId,
    activeView: state.activeView,
    layoutMode: state.layoutMode,
    selection: state.selection,
    filters: state.filters,
    highlightMode: state.highlightMode,
    neighborhood: state.neighborhood,
    asOf: state.asOf,
  };
}

function applyToStore(url: TopologyUrlState) {
  useUiStore.setState((current) => ({
    environmentId: url.environmentId ?? current.environmentId,
    activeView: url.activeView,
    layoutMode: url.layoutMode,
    selection: url.selection,
    filters: url.filters,
    highlightMode: url.highlightMode,
    neighborhood: url.neighborhood,
    asOf: url.asOf,
  }));
}

const bare = (search: string) => (search.startsWith('?') ? search.slice(1) : search);

/**
 * Keeps shared view state and the URL in step:
 * - Deep links and back/forward (POP) apply the URL to the store.
 * - Store changes write the URL: a new history entry for discrete changes (selection, view,
 *   environment, filter chips…), a replaced entry while typing a search query.
 * - In-app navigation without state (e.g. a plain link) gets the current state written back.
 */
export function useUrlStateSync() {
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const locationRef = useRef(location);
  const applying = useRef(false);
  const firstRun = useRef(true);

  useLayoutEffect(() => {
    locationRef.current = location;
  });

  // URL → store
  useEffect(() => {
    // The root route only redirects; let it carry the query string to its target untouched.
    if (location.pathname === '/') return;
    const decoded = decodeUrlState(location.search);
    const isFirst = firstRun.current;
    firstRun.current = false;
    if (decoded.issues.length > 0) console.warn('URL state:', decoded.issues.join('; '));
    if ((isFirst || navigationType === 'POP') && decoded.present) {
      applying.current = true;
      applyToStore(decoded.state);
      applying.current = false;
    }
    const canonical = encodeUrlState(fromStore(useUiStore.getState()));
    if (canonical !== bare(location.search)) {
      navigate({ pathname: location.pathname, search: canonical }, { replace: true });
    }
    // Run once per navigation; location.key identifies it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  // store → URL
  useEffect(
    () =>
      useUiStore.subscribe((state, previous) => {
        if (applying.current) return;
        const next = encodeUrlState(fromStore(state));
        const current = locationRef.current;
        if (next === bare(current.search)) return;
        const onlyQueryChanged =
          encodeUrlState(fromStore({ ...state, filters: { ...state.filters, query: previous.filters.query } })) ===
          encodeUrlState(fromStore(previous));
        navigate({ pathname: current.pathname, search: next }, { replace: onlyQueryChanged });
      }),
    [navigate],
  );
}
