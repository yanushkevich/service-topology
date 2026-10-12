import { useEffect, useState, type ReactNode } from 'react';
import { useTopology } from '../../data/topologyContext';
import { useSavedLayoutRepository } from '../../data/savedLayouts/savedLayoutContext';
import type { SavedLayout } from '../../data/savedLayouts/savedLayout';
import { DataSourceTag } from '../../shared/ui/DataSourceTag';
import { Button, Segment, Segmented } from '../../shared/ui/primitives';
import { usePreferencesStore, type Preferences } from '../../state/preferencesStore';
import { SIMULATION_SPEEDS, useSimulationStore } from '../../state/simulationStore';
import { useUiStore } from '../../state/uiStore';
import { Card, Note } from '../pages/PageShell';

/**
 * Settings (PRODUCT_SPEC Revision 5 §K.4): local display preferences, saved layouts, and the data
 * source. Preferences are per browser and never part of shared links or canonical data.
 */

const SOURCES = [
  { key: 'mock', href: '/map', label: 'Mock inventory in the browser (hand-written, with history fixtures)' },
  { key: 'dataset:scale-250', href: '/map?dataset=scale-250', label: 'Generated: 250 entities' },
  { key: 'dataset:inventory-1000', href: '/map?dataset=inventory-1000', label: 'Generated: 1,000 entities' },
  { key: 'api', href: '/map?source=api', label: 'Backend API (Go + MongoDB; run the backend first)' },
] as const;

function currentSource(search: string): string {
  const params = new URLSearchParams(search);
  if (params.get('source') === 'api') return 'api';
  const dataset = params.get('dataset');
  return dataset ? `dataset:${dataset}` : 'mock';
}

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly { id: T; label: string }[]; onChange: (value: T) => void }) {
  return (
    <Row label={label}>
      <Segmented aria-label={label}>
        {options.map((o) => (
          <Segment key={o.id} pressed={value === o.id} onClick={() => onChange(o.id)}>
            {o.label}
          </Segment>
        ))}
      </Segmented>
    </Row>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line py-2.5 first:border-t-0">
      <div className="min-w-[200px] flex-1">
        <div className="font-semibold">{label}</div>
        {hint && <div className="text-sm text-fg-2">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

export function SettingsPage() {
  const preferences = usePreferencesStore((s) => s.preferences);
  const update = usePreferencesStore((s) => s.update);
  const set = (patch: Partial<Omit<Preferences, 'schemaVersion'>>) => update(patch);

  return (
    <div className="absolute inset-0 overflow-auto">
      <div className="mx-auto flex max-w-[880px] flex-col gap-3.5 px-5 pt-[18px] pb-8 max-md:px-3 max-md:pt-3">
        <h1 className="m-0 text-xl font-semibold">Settings</h1>
        <p className="m-0 text-sm text-fg-2">Preferences are stored in this browser only. They are not included in shared links.</p>

        <Card title="Appearance">
          <Choice
            label="Theme"
            value={preferences.theme}
            options={[
              { id: 'system', label: 'System' },
              { id: 'dark', label: 'Dark' },
              { id: 'light', label: 'Light' },
            ]}
            onChange={(theme) => set({ theme })}
          />
          <Choice
            label="Motion"
            value={preferences.motion}
            options={[
              { id: 'system', label: 'Follow system' },
              { id: 'reduce', label: 'Reduce' },
            ]}
            onChange={(motion) => set({ motion })}
          />
        </Card>

        <Card title="Service Map">
          <Choice
            label="Default view"
            value={preferences.defaultView}
            options={[
              { id: '2d', label: '2D' },
              { id: '3d', label: '3D' },
            ]}
            onChange={(defaultView) => set({ defaultView })}
          />
          <Choice
            label="3D label density"
            value={preferences.galaxyLabels}
            options={[
              { id: 'minimal', label: 'Minimal' },
              { id: 'auto', label: 'Auto' },
              { id: 'all', label: 'All' },
            ]}
            onChange={(galaxyLabels) => set({ galaxyLabels })}
          />
          <Choice
            label="3D simulated traffic"
            value={preferences.galaxyTraffic ? 'on' : 'off'}
            options={[
              { id: 'on', label: 'On' },
              { id: 'off', label: 'Off' },
            ]}
            onChange={(v) => set({ galaxyTraffic: v === 'on' })}
          />
        </Card>

        <SimulationCard speed={preferences.simulationSpeed} onSpeed={(simulationSpeed) => set({ simulationSpeed })} />
        <SavedLayoutsCard />
        <DataCard />
      </div>
    </div>
  );
}

function SimulationCard({ speed, onSpeed }: { speed: Preferences['simulationSpeed']; onSpeed: (speed: Preferences['simulationSpeed']) => void }) {
  const resetSimulation = useSimulationStore((s) => s.reset);
  const [done, setDone] = useState(false);
  return (
    <Card title="Simulation">
      <Choice
        label="Default speed"
        value={speed}
        options={SIMULATION_SPEEDS}
        onChange={(next) => {
          onSpeed(next);
          useSimulationStore.getState().setSpeed(next);
        }}
      />
      <Row label="Reset simulation" hint="Clears injected failures and simulated events; returns to the baseline data.">
        <Button
          variant="danger"
          onClick={() => {
            resetSimulation();
            setDone(true);
          }}
        >
          Reset simulation
        </Button>
      </Row>
      <p role="status" className="m-0 text-sm text-fg-2">
        {done ? 'Simulation reset.' : ''}
      </p>
    </Card>
  );
}

function SavedLayoutsCard() {
  const repo = useSavedLayoutRepository();
  const [layouts, setLayouts] = useState<SavedLayout[] | null>(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let alive = true;
    void repo.list().then((list) => alive && setLayouts(list));
    return () => {
      alive = false;
    };
  }, [repo]);
  const remove = async (layout: SavedLayout) => {
    await repo.remove(layout.id);
    setLayouts(await repo.list());
    setMessage(`Deleted layout “${layout.name}”.`);
  };
  return (
    <Card title="Saved layouts" aside={<span className="text-sm text-fg-2">Save layouts from the 2D map.</span>}>
      {layouts === null ? (
        <Note>Loading…</Note>
      ) : layouts.length === 0 ? (
        <Note>No saved layouts yet.</Note>
      ) : (
        <ul className="m-0 list-none p-0">
          {layouts.map((layout) => (
            <li key={layout.id} className="flex flex-wrap items-center gap-2 border-t border-line py-2 first:border-t-0">
              <span className="min-w-0 flex-1">
                <b className="font-semibold">{layout.name}</b>{' '}
                <span className="font-mono text-xs text-fg-3">
                  {layout.view.environmentId} · {layout.view.layoutMode} · {Object.keys(layout.positions).length} positions · {new Date(layout.createdAt).toLocaleString()}
                </span>
              </span>
              <Button variant="danger" onClick={() => void remove(layout)} aria-label={`Delete layout ${layout.name}`}>
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p role="status" className="m-0 text-sm text-fg-2">
        {message}
      </p>
    </Card>
  );
}

function DataCard() {
  const topology = useTopology();
  const current = currentSource(window.location.search);
  const [message, setMessage] = useState('');
  const resetViewState = () => {
    const ui = useUiStore.getState();
    ui.select(null);
    ui.resetFilters();
    ui.setLayoutMode('topology');
    ui.setHighlightMode('direct');
    ui.setNeighborhood(null);
    ui.setAsOf(null);
    ui.exitScopeTo(0);
    ui.setActiveView(usePreferencesStore.getState().preferences.defaultView);
    setMessage('View state reset: selection, filters, layout, history, and 3D scope.');
  };
  return (
    <Card title="Data source">
      <Row label="Current source" hint="All data is mock and all telemetry is simulated, including data served by the backend (seeded from the same fixtures).">
        {topology.status === 'ready' ? <DataSourceTag sourceLabel={topology.sourceLabel} isMock={topology.isMock} /> : <span className="text-sm text-fg-2">Loading…</span>}
      </Row>
      <Row label="Dataset" hint="Switching reloads the app.">
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {SOURCES.map((d) => (
            <li key={d.key}>
              <a
                href={d.href}
                aria-current={current === d.key ? 'true' : undefined}
                className="text-sm text-accent-fg underline-offset-2 hover:underline aria-[current]:font-semibold aria-[current]:text-fg"
              >
                {d.label}
                {current === d.key ? ' (current)' : ''}
              </a>
            </li>
          ))}
        </ul>
      </Row>
      <Row label="Backend contract" hint="The Go + MongoDB backend in backend/ implements docs/api/openapi.json (OpenAPI 3.1).">
        <code className="font-mono text-sm text-fg-2">docs/API_CONTRACT.md</code>
      </Row>
      <Row label="Reset all view state" hint="Clears selection, filters, layout mode, history, and 3D scope. Preferences are kept.">
        <Button variant="secondary" onClick={resetViewState}>
          Reset view state
        </Button>
      </Row>
      <p role="status" className="m-0 text-sm text-fg-2">
        {message}
      </p>
    </Card>
  );
}
