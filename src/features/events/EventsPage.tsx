import { useEffect, useId, useMemo, useState } from 'react';
import { useSnapshotRepository } from '../../data/snapshots/snapshotContext';
import { useTopology } from '../../data/topologyContext';
import { NON_PROPAGATION_NOTES, PROPAGATION_RULES, type FailureMode } from '../../domain/propagation';
import { inEnvironment, buildRegistryRows } from '../../domain/registry';
import { diffTopology, SNAPSHOT_SCHEMA_VERSION, type SnapshotChange, type SnapshotSummary } from '../../domain/snapshot';
import { buildTopologyIndex, endpointName, kindOfId, type TopologyIndex } from '../../domain/topologyIndex';
import { CONTAINMENT_ONLY_RESOURCE_TYPES, type TopologyData } from '../../domain/types';
import { TICK_SECONDS, type SimulationEvent } from '../../simulation/engine';
import { formatTimestamp } from '../../shared/format';
import { healthLabel, relationshipStatusLabel, typeLabel } from '../../shared/mappings';
import { DataSourceTag, SimulatedTag } from '../../shared/ui/DataSourceTag';
import { LoadState } from '../../shared/ui/LoadState';
import { SIMULATION_SPEEDS, useSimulationStore } from '../../state/simulationStore';
import { useUiStore } from '../../state/uiStore';
import { InspectorPanel } from '../inspector/InspectorPanel';
import { describeEvent, formatClock } from './describeEvent';
import styles from './events.module.css';

export function EventsPage() {
  const topology = useTopology();
  const sim = useSimulationStore((s) => s.sim);
  // Names and options come from the simulation baseline, which stays stable while browsing history.
  const baselineIndex = useMemo(() => (sim ? buildTopologyIndex(sim.baseline) : null), [sim]);

  return (
    <div className={styles.page}>
      <div className={styles.main}>
        <div className={styles.heading}>
          <h1 className={styles.title}>Events & Traffic</h1>
          {topology.status === 'ready' && <DataSourceTag sourceLabel={topology.sourceLabel} isMock={topology.isMock} />}
        </div>
        {topology.status !== 'ready' || !sim || !baselineIndex ? (
          <LoadState state={topology} />
        ) : (
          <>
            <SimulationPanel index={baselineIndex} readOnly={topology.history !== null} />
            <EventLog index={baselineIndex} events={sim.events} />
            <HistoryPanel index={baselineIndex} current={sim.data} clock={sim.clock} />
            <RulesPanel />
          </>
        )}
      </div>
      <InspectorPanel />
    </div>
  );
}

const AUTO_RECOVER = [
  { label: 'Never', ticks: undefined },
  { label: '30 s', ticks: 3 },
  { label: '1 min', ticks: 6 },
  { label: '5 min', ticks: 30 },
] as const;

function SimulationPanel({ index, readOnly }: { index: TopologyIndex; readOnly: boolean }) {
  const sim = useSimulationStore((s) => s.sim);
  const running = useSimulationStore((s) => s.running);
  const speed = useSimulationStore((s) => s.speed);
  const { setRunning, setSpeed, step, reset, inject, recover, recoverAll } = useSimulationStore.getState();
  const environmentId = useUiStore((s) => s.environmentId);
  const selection = useUiStore((s) => s.selection);
  const select = useUiStore((s) => s.select);
  const entityId = useId();
  const recoverId = useId();

  // Failure targets in the current environment: instances, communicating resources, and containment.
  const options = useMemo(() => {
    const rows = buildRegistryRows(index).filter((row) => inEnvironment(row, environmentId));
    // Containment levels and brokers in this environment, plus shared ones (e.g. an account
    // spanning environments: failing it affects every environment it contains).
    const infra = index.data.resources
      .filter((r) => CONTAINMENT_ONLY_RESOURCE_TYPES.has(r.type) || r.type === 'broker')
      .filter((r) => {
        const env = environmentOfResource(index, r.id);
        return env === environmentId || env === undefined;
      })
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    return {
      services: rows.filter((r) => r.ref.kind === 'service-instance').sort((a, b) => a.name.localeCompare(b.name)),
      resources: rows.filter((r) => r.ref.kind === 'resource' && r.type !== 'broker').sort((a, b) => a.name.localeCompare(b.name)),
      infra,
    };
  }, [index, environmentId]);

  const selectedTarget =
    selection && (selection.kind === 'service-instance' || selection.kind === 'resource') && kindOfId(index, selection.id)
      ? selection.id
      : '';
  const [target, setTarget] = useState('');
  const [mode, setMode] = useState<FailureMode>('unavailable');
  const [autoRecover, setAutoRecover] = useState<number>(0);
  const effectiveTarget = target || selectedTarget || options.services[0]?.ref.id || '';

  if (!sim) return null;
  return (
    <section className={styles.card} aria-labelledby="simulation-heading">
      <div className={styles.cardHeader}>
        <h2 id="simulation-heading" className={styles.h2}>
          Simulation
        </h2>
        <SimulatedTag simulated />
        <span className={`mono ${styles.clock}`} aria-label="Simulated clock">
          {formatClock(sim.clock)} · tick {sim.tick}
        </span>
        <span className={styles.muted}>{running ? 'Running' : 'Paused'} · simulated, not observed</span>
      </div>

      {readOnly && (
        <p className={styles.note} role="status">
          You are viewing a snapshot. Simulation keeps its own state but its changes are not shown until you return to the
          current state.
        </p>
      )}

      <div className={styles.controls} role="group" aria-label="Simulation controls">
        <button type="button" className={styles.primary} onClick={() => setRunning(!running)} aria-pressed={running}>
          {running ? 'Pause' : 'Run'}
        </button>
        <button type="button" className={styles.secondary} onClick={step} disabled={running}>
          Step {TICK_SECONDS} s
        </button>
        <div className={styles.segmented} role="group" aria-label="Speed">
          {SIMULATION_SPEEDS.map((s) => (
            <button key={s.id} type="button" className={styles.segment} aria-pressed={speed === s.id} onClick={() => setSpeed(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
        <button type="button" className={styles.secondary} onClick={reset}>
          Reset to recorded state
        </button>
      </div>

      <form
        className={styles.inject}
        onSubmit={(e) => {
          e.preventDefault();
          if (!effectiveTarget) return;
          const ticks = AUTO_RECOVER[autoRecover]?.ticks;
          inject(effectiveTarget, mode, ticks);
          select({ kind: index.instances.has(effectiveTarget) ? 'service-instance' : 'resource', id: effectiveTarget });
        }}
      >
        <label htmlFor={entityId} className={styles.label}>
          Fail
        </label>
        <select id={entityId} className={styles.select} value={effectiveTarget} onChange={(e) => setTarget(e.target.value)}>
          <optgroup label="Services">
            {options.services.map((row) => (
              <option key={row.ref.id} value={row.ref.id}>
                {row.name} ({row.ref.id})
              </option>
            ))}
          </optgroup>
          <optgroup label="Data and messaging">
            {options.resources.map((row) => (
              <option key={row.ref.id} value={row.ref.id}>
                {row.name} · {typeLabel(row.type)}
              </option>
            ))}
          </optgroup>
          <optgroup label="Infrastructure">
            {options.infra.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} · {typeLabel(r.type)}
              </option>
            ))}
          </optgroup>
        </select>
        <div className={styles.segmented} role="radiogroup" aria-label="Failure mode">
          {(['unavailable', 'degraded'] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} className={styles.segment} aria-pressed={mode === m} onClick={() => setMode(m)}>
              {healthLabel(m)}
            </button>
          ))}
        </div>
        <label htmlFor={recoverId} className={styles.label}>
          Auto-recover
        </label>
        <select id={recoverId} className={styles.select} value={autoRecover} onChange={(e) => setAutoRecover(Number(e.target.value))}>
          {AUTO_RECOVER.map((o, i) => (
            <option key={o.label} value={i}>
              {o.label}
            </option>
          ))}
        </select>
        <button type="submit" className={styles.danger} disabled={!effectiveTarget}>
          Inject failure
        </button>
      </form>

      <h3 className={styles.h3}>
        Active simulated failures <span className="mono">{sim.failures.length}</span>
      </h3>
      {sim.failures.length === 0 ? (
        <p className={styles.muted}>None. Inject a failure above or from the inspector.</p>
      ) : (
        <ul className={styles.list}>
          {sim.failures.map((f) => (
            <li key={f.entityId} className={styles.row}>
              <button
                type="button"
                className={styles.link}
                onClick={() => select({ kind: index.instances.has(f.entityId) ? 'service-instance' : 'resource', id: f.entityId })}
              >
                {endpointName(index, f.entityId)}
              </button>
              <span className={styles.muted}>
                {healthLabel(f.mode)}
                {f.recoverAtTick !== undefined ? ` · auto-recovers at tick ${f.recoverAtTick}` : ''} · affects{' '}
                {sim.impacts.filter((i) => i.rootId === f.entityId).length}
              </span>
              <button type="button" className={styles.secondary} onClick={() => recover(f.entityId)}>
                Recover
              </button>
            </li>
          ))}
          {sim.failures.length > 1 && (
            <li>
              <button type="button" className={styles.secondary} onClick={recoverAll}>
                Recover all
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

function environmentOfResource(index: TopologyIndex, id: string): string | undefined {
  let current = index.resources.get(id);
  while (current) {
    if (current.environmentId) return current.environmentId;
    current = current.parentResourceId ? index.resources.get(current.parentResourceId) : undefined;
  }
  return undefined;
}

const EVENT_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'health', label: 'Health' },
  { id: 'traffic', label: 'Traffic' },
] as const;

function EventLog({ index, events }: { index: TopologyIndex; events: readonly SimulationEvent[] }) {
  const select = useUiStore((s) => s.select);
  const selection = useUiStore((s) => s.selection);
  const [filter, setFilter] = useState<(typeof EVENT_FILTERS)[number]['id']>('all');
  const [onlySelected, setOnlySelected] = useState(false);
  const shown = [...events]
    .reverse()
    .filter((e) =>
      filter === 'all' ? true : filter === 'traffic' ? e.type.startsWith('latency') : !e.type.startsWith('latency'),
    )
    .filter((e) => !onlySelected || !selection || e.entityId === selection.id || e.cause?.rootId === selection.id)
    .slice(0, 200);

  return (
    <section className={styles.card} aria-labelledby="events-heading">
      <div className={styles.cardHeader}>
        <h2 id="events-heading" className={styles.h2}>
          Event log
        </h2>
        <span className="mono">{events.length}</span>
        <div className={styles.segmented} role="group" aria-label="Event types">
          {EVENT_FILTERS.map((f) => (
            <button key={f.id} type="button" className={styles.segment} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        <label className={styles.checkbox}>
          <input type="checkbox" checked={onlySelected} onChange={(e) => setOnlySelected(e.target.checked)} disabled={!selection} />
          Only the selection
        </label>
      </div>
      {shown.length === 0 ? (
        <p className={styles.muted}>
          {events.length === 0
            ? 'No simulated events yet. Run the simulation for traffic changes, or inject a failure to see health changes and their causes.'
            : 'No events match.'}
        </p>
      ) : (
        <ol className={styles.events} aria-label="Simulated events, newest first">
          {shown.map((event) => {
            const { title, detail } = describeEvent(index, event);
            const kind = event.entityKind;
            return (
              <li key={event.id} className={styles.event}>
                <span className={`mono ${styles.eventTime}`}>{formatClock(event.at)}</span>
                <span className={styles.eventBody}>
                  <button type="button" className={styles.eventTitle} onClick={() => select({ kind, id: event.entityId })}>
                    {title}
                  </button>
                  {detail && <span className={styles.eventDetail}>{detail}</span>}
                </span>
                <SimulatedTag simulated={event.isSimulated} />
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

const CURRENT = '__current__';

function HistoryPanel({ index, current, clock }: { index: TopologyIndex; current: TopologyData; clock: string }) {
  const repository = useSnapshotRepository();
  const asOf = useUiStore((s) => s.asOf);
  const setAsOf = useUiStore((s) => s.setAsOf);
  const select = useUiStore((s) => s.select);
  const [summaries, setSummaries] = useState<SnapshotSummary[] | null>(null);
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>(CURRENT);
  const [changes, setChanges] = useState<SnapshotChange[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const fromId = useId();
  const toId = useId();

  useEffect(() => {
    let cancelled = false;
    repository.list().then((list) => {
      if (!cancelled) setSummaries(list);
    });
    return () => {
      cancelled = true;
    };
  }, [repository, version]);

  const fromValue = from || summaries?.[0]?.id || CURRENT;

  const loadData = async (id: string) => (id === CURRENT ? current : ((await repository.get(id))?.data ?? null));
  const compare = async () => {
    const [a, b] = await Promise.all([loadData(fromValue), loadData(to)]);
    setChanges(a && b ? diffTopology(a, b) : []);
  };
  const capture = async () => {
    const id = `capture-${Date.parse(clock).toString(36)}-${(summaries?.length ?? 0) + 1}`;
    await repository.save({
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      id,
      label: `Simulation capture · ${formatClock(clock)}`,
      takenAt: clock,
      source: 'simulation',
      isSimulated: true,
      data: current,
    });
    setMessage('Captured the current simulated state.');
    setVersion((v) => v + 1);
  };
  const nameOf = (change: SnapshotChange) => (change.kind === 'relationship' ? relationshipName(index, change.id) : endpointName(index, change.id));

  return (
    <section className={styles.card} aria-labelledby="history-heading">
      <div className={styles.cardHeader}>
        <h2 id="history-heading" className={styles.h2}>
          History
        </h2>
        <span className={styles.muted}>Fixture snapshots and captures of the simulation. Browsing one never changes current state.</span>
      </div>
      {summaries === null ? (
        <p className={styles.muted}>Loading snapshots…</p>
      ) : summaries.length === 0 ? (
        <p className={styles.muted}>No snapshots for this data source.</p>
      ) : (
        <ul className={styles.list} aria-label="Snapshots">
          {summaries.map((s) => (
            <li key={s.id} className={styles.row}>
              <span className={styles.snapshotText}>
                <b>{s.label}</b>
                <span className="mono">
                  {formatTimestamp(s.takenAt)} · {s.source === 'fixture' ? 'fixture' : s.source === 'simulation' ? 'simulation capture' : 'observed'}
                </span>
              </span>
              <SimulatedTag simulated={s.isSimulated} />
              <button
                type="button"
                className={asOf === s.id ? styles.primary : styles.secondary}
                aria-pressed={asOf === s.id}
                onClick={() => setAsOf(asOf === s.id ? null : s.id)}
              >
                {asOf === s.id ? 'Viewing' : 'View as of'}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.controls}>
        <button type="button" className={styles.secondary} onClick={() => void capture()}>
          Capture current state
        </button>
        {message && (
          <span className={styles.muted} role="status">
            {message}
          </span>
        )}
      </div>

      <h3 className={styles.h3}>Compare</h3>
      <div className={styles.controls}>
        <label htmlFor={fromId} className={styles.label}>
          From
        </label>
        <select id={fromId} className={styles.select} value={fromValue} onChange={(e) => setFrom(e.target.value)}>
          {summaries?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
          <option value={CURRENT}>Current (simulated)</option>
        </select>
        <label htmlFor={toId} className={styles.label}>
          To
        </label>
        <select id={toId} className={styles.select} value={to} onChange={(e) => setTo(e.target.value)}>
          {summaries?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
          <option value={CURRENT}>Current (simulated)</option>
        </select>
        <button type="button" className={styles.secondary} onClick={() => void compare()}>
          Compare
        </button>
      </div>
      {changes !== null &&
        (changes.length === 0 ? (
          <p className={styles.muted} role="status">
            No differences.
          </p>
        ) : (
          <ul className={styles.list} aria-label="Differences">
            {changes.map((change) => (
              <li key={`${change.type}:${change.id}`} className={styles.row}>
                <button
                  type="button"
                  className={styles.link}
                  onClick={() => (change.kind === 'environment' || change.kind === 'service-definition' ? undefined : select({ kind: change.kind, id: change.id }))}
                >
                  {nameOf(change)}
                </button>
                <span className={styles.muted}>{describeChange(change)}</span>
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
}

function relationshipName(index: TopologyIndex, id: string): string {
  const r = index.relationships.get(id);
  return r ? `${endpointName(index, r.sourceEntityId)} → ${endpointName(index, r.targetEntityId)}` : id;
}

function describeChange(change: SnapshotChange): string {
  switch (change.type) {
    case 'health-changed':
      return `${healthLabel(change.from)} → ${healthLabel(change.to)}`;
    case 'status-changed':
      return `${relationshipStatusLabel(change.from)} → ${relationshipStatusLabel(change.to)}`;
    case 'added':
      return `Added (${change.kind.replace('-', ' ')})`;
    case 'removed':
      return `Removed (${change.kind.replace('-', ' ')})`;
  }
}

function RulesPanel() {
  return (
    <section className={styles.card} aria-labelledby="rules-heading">
      <div className={styles.cardHeader}>
        <h2 id="rules-heading" className={styles.h2}>
          How simulated failures propagate
        </h2>
      </div>
      <table className={styles.rules}>
        <thead>
          <tr>
            <th scope="col">Rule</th>
            <th scope="col">When</th>
            <th scope="col">Effect</th>
            <th scope="col">Why</th>
          </tr>
        </thead>
        <tbody>
          {PROPAGATION_RULES.map((rule) => (
            <tr key={rule.id}>
              <th scope="row">{rule.title}</th>
              <td>{rule.when}</td>
              <td>
                {rule.effect}
                {!rule.transitive && ' Stops here.'}
              </td>
              <td>{rule.rationale}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3 className={styles.h3}>Does not propagate</h3>
      <ul className={styles.notes}>
        {NON_PROPAGATION_NOTES.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </section>
  );
}
