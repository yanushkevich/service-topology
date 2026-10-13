import { useEffect, useId, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { NAV_ITEMS } from '../app/navigation';
import { useSimulationStore } from '../state/simulationStore';
import { formatClock } from '../shared/format';
import { useTopology } from '../data/topologyContext';
import { sortEnvironments } from '../domain/topologyIndex';
import { useUiStore } from '../state/uiStore';
import { usePreferencesStore } from '../state/preferencesStore';
import { Icon } from '../shared/ui/Icon';
import { NewEntityMenu } from '../features/editing/EditingControls';
import { QuickSearchDialog } from '../features/search/QuickSearchDialog';

/** Pages the quick search can open. */
const SEARCH_PAGES = NAV_ITEMS.map(({ path, label }) => ({ path, label }));
/** The shortcut as this platform writes it. */
const SHORTCUT = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘K' : 'Ctrl K';

export function Header() {
  const theme = useUiStore((s) => s.theme);
  const setThemePreference = (next: 'dark' | 'light') => usePreferencesStore.getState().update({ theme: next });
  const environmentId = useUiStore((s) => s.environmentId);
  const setEnvironmentId = useUiStore((s) => s.setEnvironmentId);
  const topology = useTopology();
  const location = useLocation();
  const [searchOpen, setSearchOpen] = useState(false);
  useSearchShortcut(setSearchOpen);
  const environments = topology.status === 'ready' ? sortEnvironments(topology.index.data.environments) : [];
  const fallbackEnvironment = environments[0]?.id;
  const environmentKnown = environments.length === 0 || environments.some((env) => env.id === environmentId);
  // An unknown environment (e.g. from an old deep link) falls back to the first one, visibly in the selector.
  useEffect(() => {
    if (!environmentKnown && fallbackEnvironment) setEnvironmentId(fallbackEnvironment);
  }, [environmentKnown, fallbackEnvironment, setEnvironmentId]);
  const envSelectId = useId();
  const nextTheme = theme === 'dark' ? 'light' : 'dark';

  return (
    <header className="relative z-30 flex min-h-[52px] flex-none flex-wrap items-center gap-2.5 border-b border-line bg-surface-1 px-3.5 py-2">
      <div className="flex items-center gap-[9px]">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" strokeWidth="1.5" aria-hidden="true">
          <ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(-28 12 12)" stroke="var(--color-ice)" />
          <ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(42 12 12)" stroke="var(--color-indigo)" />
          <circle cx="12" cy="12" r="2.2" fill="var(--color-accent)" stroke="var(--color-accent)" />
        </svg>
        <span className="text-lg font-semibold tracking-[-0.01em]">Service Topology</span>
      </div>
      <div className={`mx-1 h-5 w-px bg-line-strong max-md:hidden`} aria-hidden="true" />

      <div className="relative flex h-8 items-center gap-2 rounded-md border border-control bg-surface-2 px-2.5 whitespace-nowrap text-fg-2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">
        <label htmlFor={envSelectId} className="sr-only">
          Environment
        </label>
        <span className="size-[7px] rounded-[2px] bg-ok" aria-hidden="true" />
        <select
          id={envSelectId}
          className={`cursor-pointer appearance-none border-0 bg-transparent pr-5 text-sm text-fg focus-visible:outline-none [&_option]:bg-surface-2 [&_option]:text-fg font-mono`}
          value={environmentId}
          onChange={(e) => setEnvironmentId(e.target.value)}
          disabled={environments.length === 0}
        >
          {environments.length === 0 && <option value={environmentId}>{environmentId}</option>}
          {environments.map((env) => (
            <option key={env.id} value={env.id}>
              {env.id}
            </option>
          ))}
        </select>
        <Icon name="chevronDown" className="pointer-events-none absolute right-2" />
      </div>

      <button
        type="button"
        className="flex h-8 max-w-[440px] min-w-0 flex-[1_1_260px] items-center gap-2 rounded-md border border-control bg-surface-2 px-2.5 text-fg-3 hover:border-line-strong max-md:size-8.5 max-md:flex-none max-md:justify-center max-md:px-0"
        onClick={() => setSearchOpen(true)}
        aria-haspopup="dialog"
        aria-keyshortcuts="Meta+K Control+K"
        aria-label="Search services, flows, events"
        title={`Search (${SHORTCUT})`}
      >
        <Icon name="search" />
        <span className="min-w-0 flex-1 truncate text-left max-md:hidden">Search services, flows, events…</span>
        <kbd className="rounded-[5px] border border-line-strong px-1.5 font-mono text-[10.5px] max-md:hidden">{SHORTCUT}</kbd>
      </button>
      {searchOpen && <QuickSearchDialog pages={SEARCH_PAGES} onClose={() => setSearchOpen(false)} />}

      <div className="ml-auto flex items-center gap-1.5">
        <NewEntityMenu />
        <SimulationChip search={location.search} />
        <button
          type="button"
          className="grid size-8.5 place-items-center rounded-md text-fg-2 transition-colors hover:bg-surface-3 hover:text-fg"
          onClick={() => setThemePreference(nextTheme)}
          aria-label={`Switch to ${nextTheme} theme`}
          title={`Switch to ${nextTheme} theme`}
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
        </button>
      </div>
    </header>
  );
}

/** ⌘K / Ctrl+K opens the quick search from anywhere (ADR-033). */
function useSearchShortcut(setOpen: (open: boolean) => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [setOpen]);
}

/** Simulation status. Deliberately never says "live": all data here is mock/simulated. */
function SimulationChip({ search }: { search: string }) {
  const sim = useSimulationStore((s) => s.sim);
  const running = useSimulationStore((s) => s.running);
  if (!sim) return null;
  const failures = sim.failures.length;
  return (
    <Link
      to={{ pathname: '/simulation', search }}
      className="inline-flex h-7.5 items-center gap-1.5 rounded-full border border-dashed border-warn px-2.5 text-sm whitespace-nowrap text-warn-fg no-underline hover:bg-warn/10"
      title="Simulated clock and status. Open Simulation"
    >
      {/* Visible text first, so the accessible name contains it (WCAG 2.5.3). */}
      <span aria-hidden="true">{running ? '▶' : '❚❚'}</span>
      <span>Simulated</span>
      <span className="font-mono">{formatClock(sim.clock)}</span>
      {failures > 0 && <span className="font-mono">· {failures} failing</span>}
      <span className="sr-only">, simulation {running ? 'running' : 'paused'}. Open Simulation</span>
    </Link>
  );
}
