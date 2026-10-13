import { useId } from 'react';
import { PATTERN_IDS, patternLabel } from '../../../domain/patterns';
import type { TopologyData } from '../../../domain/types';
import { LINE_GROUPS, STATION_KINDS, type BoardDefinition, type LineDefinition } from '../../../transit/definition';
import { GROUP_LABELS } from '../../../transit/board';
import { POLICY_TYPES, type StationKind } from '../../../transit/types';
import { Button } from '../../../shared/ui/primitives';
import { CheckboxGroup, FieldGroup, NumberInput, SelectInput, TextInput } from '../../../shared/ui/form';
import { formatConfig, nextLineCode, parseConfig, stationId, transactionsFrom, uniqueId, withoutLine, withoutStation, slug } from './boardForm';

/**
 * The sections of the board editor (ADR-031): stations, endpoints (lines with their routes),
 * client policies, and tables. Every field names its path in the definition, so a validation
 * issue focuses the right input.
 */

export interface SectionProps {
  def: BoardDefinition;
  update: (change: (d: BoardDefinition) => BoardDefinition | undefined) => void;
  errors: Readonly<Record<string, string>>;
}

const KIND_LABEL: Record<StationKind, string> = { caller: 'Caller', gate: 'Entry gate', module: 'Module', client: 'Client', dependency: 'Dependency' };
const rowClass = 'flex flex-col gap-2 rounded-lg border border-line p-2.5';

export function StationsSection({ def, update, errors, topology }: SectionProps & { topology: TopologyData }) {
  const entities = [
    ...topology.serviceDefinitions.map((d) => ({ value: d.id, label: `${d.name} (service)` })),
    ...topology.resources.filter((r) => !['account', 'subscription', 'project', 'region', 'datacenter', 'cluster', 'namespace'].includes(r.type)).map((r) => ({ value: r.id, label: `${r.name} (${r.type})` })),
  ].sort((a, b) => a.label.localeCompare(b.label, 'en'));
  return (
    <FieldGroup legend={`Stations · ${def.stations.length}`}>
      <p className="m-0 text-xs text-fg-3">Stations are where a request passes: callers, entry gates, modules, outbound clients, and dependencies. Link dependencies to the topology so their health shows.</p>
      {def.stations.map((s, i) => (
        <div key={s.id} className={rowClass} data-station-row={s.id}>
          <div className="grid grid-cols-[minmax(0,1fr)_150px] gap-2">
            <TextInput compact label="Name" path={`stations[${i}].name`} required value={s.name} error={errors[`stations[${i}].name`]} onChange={(v) => update((d) => void (item(d.stations, i).name = v))} />
            <SelectInput compact label="Kind" path={`stations[${i}].kind`} value={s.kind} options={STATION_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))} error={errors[`stations[${i}].kind`]} onChange={(v) => update((d) => void (item(d.stations, i).kind = v as StationKind))} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <TextInput compact label="Subtitle" path={`stations[${i}].sub`} value={s.sub ?? ''} hint="e.g. tx, HTTPS, primary" onChange={(v) => update((d) => void (item(d.stations, i).sub = v || undefined))} />
            {s.kind === 'dependency' && (
              <SelectInput
                compact
                label="Topology entity"
                path={`stations[${i}].entityId`}
                value={s.entityId ?? ''}
                empty="Not in the topology"
                options={entities}
                error={errors[`stations[${i}].entityId`]}
                onChange={(v) => update((d) => void (item(d.stations, i).entityId = v || undefined))}
              />
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[11px] text-fg-3">{s.id}</span>
            <Button variant="ghost" onClick={() => update((d) => withoutStation(d, s.id))} aria-label={`Remove station ${s.name || s.id}`}>
              Remove
            </Button>
          </div>
        </div>
      ))}
      <AddStation def={def} update={update} />
    </FieldGroup>
  );
}

function AddStation({ update }: Pick<SectionProps, 'def' | 'update'>) {
  const id = useId();
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-labelledby={id}>
      <span id={id} className="text-sm text-fg-2">
        Add a station:
      </span>
      {STATION_KINDS.map((kind) => (
        <Button key={kind} onClick={() => update((d) => void d.stations.push({ id: stationId(kind, `new ${kind}`, d), name: `New ${KIND_LABEL[kind].toLowerCase()}`, kind }))}>
          {KIND_LABEL[kind]}
        </Button>
      ))}
    </div>
  );
}

export function LinesSection({ def, update, errors }: SectionProps) {
  const stationOptions = def.stations.map((s) => ({ value: s.id, label: `${s.name} (${KIND_LABEL[s.kind].toLowerCase()})` }));
  return (
    <FieldGroup legend={`Endpoints · ${def.lines.length}`}>
      <p className="m-0 text-xs text-fg-3">Each endpoint is a line: a gRPC method, an HTTP route, a consumed event, a schedule, or a background job, with the route its requests take.</p>
      {def.lines.map((l, i) => (
        <details key={l.id} className={rowClass} open={Object.keys(errors).some((p) => p.startsWith(`lines[${i}]`)) || undefined} data-line-row={l.id}>
          <summary className="cursor-pointer text-sm font-medium">
            <span className="font-mono">{l.code}</span> · {l.name || 'Unnamed endpoint'}
          </summary>
          <LineFields def={def} line={l} i={i} update={update} errors={errors} stationOptions={stationOptions} />
        </details>
      ))}
      <Button
        onClick={() =>
          update((d) => {
            const code = nextLineCode('http', d);
            const first = d.stations.find((s) => s.kind === 'caller') ?? d.stations[0];
            const second = d.stations.find((s) => s.kind === 'gate') ?? d.stations[1];
            d.lines.push({ id: code, code, name: 'New endpoint', group: 'http', signature: 'GET /new', caller: first?.name ?? '', route: [{ stations: [first?.id ?? '', second?.id ?? ''].filter(Boolean), kind: 'sequential' }], patterns: [] });
          })
        }
      >
        Add an endpoint
      </Button>
    </FieldGroup>
  );
}

function LineFields({ def, line, i, update, errors, stationOptions }: SectionProps & { line: LineDefinition; i: number; stationOptions: { value: string; label: string }[] }) {
  const at = `lines[${i}]`;
  const set = (change: (l: LineDefinition) => void) => update((d) => void change(item(d.lines, i)));
  const written = def.tables.filter((t) => t.writes.includes(line.id));
  const inTx = new Set((line.transactions ?? []).flatMap((t) => t.tableIds));
  return (
    <div className="flex flex-col gap-2 pt-2">
      <div className="grid grid-cols-[90px_minmax(0,1fr)_150px] gap-2">
        <TextInput compact label="Code" path={`${at}.code`} required mono value={line.code} error={errors[`${at}.code`]} onChange={(v) => set((l) => void (l.code = v))} />
        <TextInput compact label="Name" path={`${at}.name`} required value={line.name} error={errors[`${at}.name`]} onChange={(v) => set((l) => void (l.name = v))} />
        <SelectInput compact label="Kind" path={`${at}.group`} value={line.group} options={LINE_GROUPS.map((g) => ({ value: g, label: GROUP_LABELS[g] }))} onChange={(v) => set((l) => void (l.group = v as LineDefinition['group']))} />
      </div>
      <TextInput compact label="Signature" path={`${at}.signature`} mono value={line.signature} hint="As specs name it: 'POST /v1/orders', 'rpc Capture(…)', 'consume orders.events'. HTTP signatures match OpenAPI operations." onChange={(v) => set((l) => void (l.signature = v))} />
      <div className="grid grid-cols-3 gap-2">
        <TextInput compact label="Caller" path={`${at}.caller`} value={line.caller} onChange={(v) => set((l) => void (l.caller = v))} />
        <NumberInput compact label="Deadline (ms)" path={`${at}.deadlineMs`} value={line.deadlineMs} error={errors[`${at}.deadlineMs`]} onChange={(v) => set((l) => void (l.deadlineMs = v))} />
        <TextInput compact label="Repeats" path={`${at}.repeat`} value={line.repeat ?? ''} hint="e.g. every 200 ms" onChange={(v) => set((l) => void (l.repeat = v || undefined))} />
      </div>

      {line.route.map((_, j) => (
        <BranchFields key={j} line={line} i={i} j={j} update={update} errors={errors} stationOptions={stationOptions} />
      ))}
      {errors[`${at}.route`] && <p className="m-0 text-xs text-crit-fg">{errors[`${at}.route`]}</p>}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => set((l) => void l.route.push({ stations: [l.route[0]?.stations.at(-2) ?? l.route[0]?.stations[0] ?? '', ''].filter(Boolean), kind: 'alternative', share: 0.1 }))}>Add a branch</Button>
      </div>

      <CheckboxGroup
        label="Patterns"
        name={`${at}.patterns`}
        options={PATTERN_IDS.map((p) => ({ value: p, label: patternLabel(p) }))}
        value={line.patterns}
        onChange={(v) => set((l) => void (l.patterns = v as LineDefinition['patterns']))}
      />
      {written.length > 1 && (
        <CheckboxGroup
          label="Written in one transaction"
          name={`${at}.transactions`}
          hint="Tables this endpoint commits together; shown as a transaction in the process view."
          options={written.map((t) => ({ value: t.id, label: t.name }))}
          value={[...inTx]}
          onChange={(v) => update((d) => void (item(d.lines, i).transactions = transactionsFrom(v, d)))}
        />
      )}
      <div className="flex justify-end">
        <Button variant="ghost" onClick={() => update((d) => withoutLine(d, line.id))} aria-label={`Remove endpoint ${line.code}`}>
          Remove endpoint
        </Button>
      </div>
    </div>
  );
}

function BranchFields({ line, i, j, update, errors, stationOptions }: Omit<SectionProps, 'def'> & { line: LineDefinition; i: number; j: number; stationOptions: { value: string; label: string }[] }) {
  const branch = item(line.route, j);
  const at = `lines[${i}].route[${j}]`;
  const set = (change: (b: LineDefinition['route'][number]) => void) => update((d) => void change(item(item(d.lines, i).route, j)));
  return (
    <fieldset className="m-0 flex flex-col gap-1.5 rounded-md border border-line-strong p-2" data-branch={`${line.id}:${j}`}>
      <legend className="px-1 text-xs font-semibold">{j === 0 ? 'Route' : `Branch ${j}`}</legend>
      <ol className="m-0 flex list-none flex-col gap-1 p-0">
        {branch.stations.map((sid, k) => (
          <li key={k} className="flex items-end gap-1.5">
            <div className="min-w-0 flex-1">
              <SelectInput compact label={`Stop ${k + 1}`} path={`${at}.stations[${k}]`} value={sid} options={stationOptions} error={errors[`${at}.stations[${k}]`]} onChange={(v) => set((b) => void (b.stations[k] = v))} />
            </div>
            <Button variant="ghost" onClick={() => set((b) => void b.stations.splice(k, 1))} aria-label={`Remove stop ${k + 1}`}>
              ×
            </Button>
          </li>
        ))}
      </ol>
      {errors[`${at}.stations`] && <p className="m-0 text-xs text-crit-fg">{errors[`${at}.stations`]}</p>}
      <div className="flex flex-wrap items-end gap-2">
        <Button onClick={() => set((b) => void b.stations.push(stationOptions[0]?.value ?? ''))}>Add a stop</Button>
        {j > 0 && (
          <>
            <SelectInput
              compact
              label="Runs"
              path={`${at}.kind`}
              value={branch.parallel ? 'parallel' : branch.kind}
              options={[
                { value: 'sequential', label: 'always' },
                { value: 'alternative', label: 'on some requests' },
                { value: 'parallel', label: 'in parallel' },
              ]}
              onChange={(v) =>
                set((b) => {
                  b.kind = v === 'alternative' ? 'alternative' : 'sequential';
                  b.parallel = v === 'parallel' ? true : undefined;
                })
              }
            />
            {branch.kind === 'alternative' && (
              <>
                <TextInput compact label="When" path={`${at}.condition`} value={branch.condition ?? ''} hint="e.g. cache miss" onChange={(v) => set((b) => void (b.condition = v || undefined))} />
                <NumberInput compact label="Share (0–1)" path={`${at}.share`} value={branch.share} error={errors[`${at}.share`]} onChange={(v) => set((b) => void (b.share = v))} />
              </>
            )}
            <Button variant="ghost" onClick={() => update((d) => void item(d.lines, i).route.splice(j, 1))} aria-label={`Remove branch ${j}`}>
              Remove branch
            </Button>
          </>
        )}
      </div>
    </fieldset>
  );
}

export function PoliciesSection({ def, update, errors }: SectionProps) {
  const clients = def.stations.filter((s) => s.kind === 'client').map((s) => ({ value: s.id, label: s.name }));
  return (
    <FieldGroup legend={`Policies · ${def.policies.length}`}>
      <p className="m-0 text-xs text-fg-3">Resilience on outbound clients, in the order a call passes them. Mark a policy missing when it is expected but not configured.</p>
      {def.policies.map((p, i) => (
        <div key={p.id} className={rowClass} data-policy-row={p.id}>
          <div className="grid grid-cols-[minmax(0,1fr)_150px_80px] gap-2">
            <SelectInput compact label="Client" path={`policies[${i}].clientId`} value={p.clientId} options={clients} error={errors[`policies[${i}].clientId`]} onChange={(v) => update((d) => void (item(d.policies, i).clientId = v))} />
            <SelectInput compact label="Type" path={`policies[${i}].type`} value={p.type} options={POLICY_TYPES.map((t) => ({ value: t, label: patternLabel(t) }))} onChange={(v) => update((d) => void (item(d.policies, i).type = v as typeof p.type))} />
            <NumberInput compact label="Order" path={`policies[${i}].order`} value={p.order} onChange={(v) => update((d) => void (item(d.policies, i).order = v ?? 0))} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <TextInput compact label="Label" path={`policies[${i}].label`} value={p.label} hint="e.g. retry ×3, 2 s" onChange={(v) => update((d) => void (item(d.policies, i).label = v))} />
            <TextInput compact label="Config" path={`policies[${i}].config`} mono value={formatConfig(p.config)} hint="key=value, separated by commas" onChange={(v) => update((d) => void (item(d.policies, i).config = parseConfig(v)))} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={p.missing === true} onChange={(e) => update((d) => void (item(d.policies, i).missing = e.target.checked || undefined))} />
              Expected here but missing
            </label>
            <Button variant="ghost" onClick={() => update((d) => void d.policies.splice(i, 1))} aria-label={`Remove policy ${p.label || p.id}`}>
              Remove
            </Button>
          </div>
        </div>
      ))}
      <Button
        disabled={clients.length === 0}
        onClick={() => update((d) => void d.policies.push({ id: uniqueId('policy', d.policies.map((p) => p.id)), clientId: clients[0]?.value ?? '', order: d.policies.length, type: 'timeout', label: 'timeout' }))}
      >
        Add a policy
      </Button>
      {clients.length === 0 && <p className="m-0 text-xs text-fg-3">Add a client station first: policies sit on outbound clients.</p>}
    </FieldGroup>
  );
}

export function TablesSection({ def, update, errors }: SectionProps) {
  const dependencies = def.stations.filter((s) => s.kind === 'dependency').map((s) => ({ value: s.id, label: s.name }));
  const lines = def.lines.map((l) => ({ value: l.id, label: `${l.code} · ${l.name}` }));
  return (
    <FieldGroup legend={`Tables · ${def.tables.length}`}>
      <p className="m-0 text-xs text-fg-3">Where endpoints meet a database: which tables they write and read, and which pattern a table serves (an outbox or an inbox).</p>
      {def.tables.map((t, i) => (
        <div key={t.id} className={rowClass} data-table-row={t.id}>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_150px] gap-2">
            <TextInput compact label="Table" path={`tables[${i}].name`} mono required value={t.name} onChange={(v) => update((d) => void (item(d.tables, i).name = v))} />
            <SelectInput compact label="Database" path={`tables[${i}].stationId`} value={t.stationId} options={dependencies} error={errors[`tables[${i}].stationId`]} onChange={(v) => update((d) => void (item(d.tables, i).stationId = v))} />
            <SelectInput compact label="Pattern" path={`tables[${i}].pattern`} value={t.pattern ?? ''} empty="None (state)" options={[{ value: 'outbox', label: 'Transactional outbox' }, { value: 'inbox', label: 'Inbox' }]} onChange={(v) => update((d) => void (item(d.tables, i).pattern = (v || undefined) as typeof t.pattern))} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <CheckboxGroup label="Written by" name={`tables[${i}].writes`} options={lines} value={t.writes} error={firstError(errors, `tables[${i}].writes`)} onChange={(v) => update((d) => void (item(d.tables, i).writes = v))} />
            <CheckboxGroup label="Read by" name={`tables[${i}].reads`} options={lines} value={t.reads} error={firstError(errors, `tables[${i}].reads`)} onChange={(v) => update((d) => void (item(d.tables, i).reads = v))} />
          </div>
          <div className="flex justify-end">
            <Button variant="ghost" onClick={() => update((d) => void d.tables.splice(i, 1))} aria-label={`Remove table ${t.name}`}>
              Remove
            </Button>
          </div>
        </div>
      ))}
      <Button disabled={dependencies.length === 0} onClick={() => update((d) => void d.tables.push({ id: uniqueId(slug('new table'), d.tables.map((x) => x.id)), stationId: dependencies[0]?.value ?? '', name: 'new_table', writes: [], reads: [] }))}>
        Add a table
      </Button>
      {dependencies.length === 0 && <p className="m-0 text-xs text-fg-3">Add a dependency station first: tables belong to a database.</p>}
    </FieldGroup>
  );
}

/** The first error under a path prefix (a list field reports per item; the group shows one). */
function firstError(errors: Readonly<Record<string, string>>, prefix: string): string | undefined {
  return Object.entries(errors).find(([p]) => p.startsWith(prefix))?.[1];
}

/** The item at an index the form just rendered; a missing one is a bug, not user input. */
function item<T>(list: readonly T[], i: number): T {
  const value = list[i];
  if (value === undefined) throw new Error(`No item ${i} in a list of ${list.length}`);
  return value;
}
