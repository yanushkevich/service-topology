import { patternLabel } from '../domain/patterns';
import type { BusinessFlow, FlowPolicy, FlowStep, FlowTransition } from '../domain/types';
import { tablesOfLine, type BoardIndex } from './board';
import { laneOrder, OUTCOMES_LANE } from './flows/swimlane';
import type { Line, PolicyStop } from './types';

/**
 * The process view (ADR-028, docs/BUSINESS_FLOWS.md Revision 4 §17): a line or a flow as a sequence
 * diagram. Lifelines are stations (a line) or services (a flow); items are messages, notes, and
 * fragments. Everything comes from declared or modelled data; nothing is inferred. Pure.
 */

export interface Lifeline {
  id: string;
  name: string;
  sub?: string | undefined;
}

export type MessageStyle = 'call' | 'async' | 'reply' | 'write' | 'read' | 'local';

export type FragmentType = 'alt' | 'opt' | 'loop' | 'par' | 'transaction' | 'compensation';

export interface Section {
  /** The condition of an alt or opt section, or 'else'. */
  guard?: string | undefined;
  /** Observed share of the section, 0..1. */
  share?: number | undefined;
  items: ProcessItem[];
}

export type ProcessItem =
  | { kind: 'message'; id: string; from: string; to: string; label: string; style: MessageStyle; guards: string[] }
  | { kind: 'note'; id: string; at: string; text: string }
  | { kind: 'fragment'; id: string; type: FragmentType; guard?: string | undefined; sections: Section[] };

export interface Process {
  lifelines: Lifeline[];
  items: ProcessItem[];
}

// ---------------------------------------------------------------------------------------------
// A service-board line
// ---------------------------------------------------------------------------------------------

const REQUEST_GROUPS = new Set(['grpc', 'http', 'webhook']);

/**
 * A line as a sequence: the endpoint call, each hop along its route, the policies on each
 * dependency call (retry as a loop, the rest as guards), its table writes (in a transaction when
 * declared), its branches (opt for alternatives, par for parallel forks), and the reply.
 */
export function lineProcess(index: BoardIndex, line: Line): Process {
  const lifelines: Lifeline[] = [];
  const seen = new Set<string>();
  for (const branch of line.route) {
    for (const id of branch.stations) {
      if (seen.has(id)) continue;
      seen.add(id);
      const s = index.stations.get(id);
      lifelines.push({ id, name: s?.name ?? id, sub: s?.sub });
    }
  }
  const [main, ...forks] = line.route;
  if (!main) return { lifelines, items: [] };

  const hops = (stations: readonly string[], key: string) => stations.slice(1).flatMap((to, i) => hopItems(index, line, stations[i] ?? '', to, `${key}:${i}`));
  const parallel = forks.filter((f) => f.parallel);
  let items: ProcessItem[];
  const forkAt = parallel[0]?.stations[0];
  const k = forkAt ? main.stations.indexOf(forkAt) : -1;
  if (parallel.length && k >= 0) {
    items = [
      ...hops(main.stations.slice(0, k + 1), 'main'),
      { kind: 'fragment', id: 'par', type: 'par', sections: [{ items: hops(main.stations.slice(k), 'main-rest') }, ...parallel.map((f, i) => ({ items: hops(f.stations, `par${i}`) }))] },
    ];
  } else {
    items = hops(main.stations, 'main');
  }
  forks.forEach((fork, i) => {
    if (fork.parallel) return;
    const body = hops(fork.stations, `fork${i}`);
    if (fork.kind === 'alternative') items.push({ kind: 'fragment', id: `opt${i}`, type: 'opt', guard: fork.condition ?? 'some requests', sections: [{ guard: fork.condition ?? 'some requests', share: fork.share, items: body }] });
    else items.push(...body);
  });

  const caller = main.stations[0];
  const gate = main.stations[1];
  if (REQUEST_GROUPS.has(line.group) && caller && gate) items.push({ kind: 'message', id: 'reply', from: gate, to: caller, label: 'reply', style: 'reply', guards: [] });
  if (line.repeat) items = [{ kind: 'fragment', id: 'repeat', type: 'loop', guard: line.repeat, sections: [{ guard: line.repeat, items }] }];
  return { lifelines, items };
}

/** One hop of a route: the message, wrapped in a retry loop and a transaction where declared. */
function hopItems(index: BoardIndex, line: Line, from: string, to: string, id: string): ProcessItem[] {
  const a = index.stations.get(from);
  const b = index.stations.get(to);
  if (a?.kind === 'caller') return [{ kind: 'message', id, from, to, label: line.signature, style: line.group === 'event' ? 'async' : 'call', guards: [] }];
  if (b?.kind !== 'dependency') return [{ kind: 'message', id, from, to, label: b?.kind === 'client' ? `call through ${b.name}` : `to ${b?.name ?? to}`, style: 'call', guards: [] }];

  // A dependency call: the client lane's policies, then what it does there.
  const policies = index.policiesByClient.get(from) ?? [];
  const retry = policies.find((p) => p.type === 'retry' && p.state !== 'missing' && p.state !== 'unknown');
  const guards = policies.filter((p) => p !== retry).map(policyGuard);
  const uses = tablesOfLine(index, line).filter((u) => u.table.stationId === to);
  let body: ProcessItem[];
  if (uses.length === 0) {
    body = [{ kind: 'message', id, from, to, label: `call ${b.name}`, style: 'call', guards }];
  } else {
    const messages = uses.map(({ table, writes }) => ({
      table,
      item: {
        kind: 'message',
        id: `${id}:${table.id}`,
        from,
        to,
        label: `${writes ? 'write' : 'read'} ${table.name}${table.pattern ? ` (${patternLabel(table.pattern).toLowerCase()})` : ''}`,
        style: writes ? 'write' : 'read',
        guards,
      } satisfies ProcessItem as ProcessItem,
    }));
    const tx = new Set(line.transactions?.find((t) => t.stationId === to)?.tableIds ?? []);
    const inTx = messages.filter((m) => tx.has(m.table.id)).map((m) => m.item);
    const outside = messages.filter((m) => !tx.has(m.table.id)).map((m) => m.item);
    body = inTx.length ? [{ kind: 'fragment', id: `${id}:tx`, type: 'transaction', guard: 'one transaction', sections: [{ items: inTx }] }, ...outside] : outside;
  }
  return retry ? [{ kind: 'fragment', id: `${id}:retry`, type: 'loop', guard: retry.label, sections: [{ guard: retry.label, items: body }] }] : body;
}

const policyGuard = (p: PolicyStop) => (p.state === 'missing' ? `${p.label} (missing)` : p.state === 'unknown' ? `${patternLabel(p.type).toLowerCase()} unknown` : p.label);

// ---------------------------------------------------------------------------------------------
// A business flow
// ---------------------------------------------------------------------------------------------

/**
 * A flow as a sequence across services: each transition a message (calls, events, or local
 * steps); a step whose exits are all conditional as alt; a conditional exit beside unconditional
 * ones as opt; unconditional exits that run together as par; retries and redeliveries as loops, compensation as its own fragment, waits as
 * notes, and outcomes ending their section. A step reached again "continues at" instead of repeating.
 */
export function flowProcess(flow: BusinessFlow, options: { serviceName: (id: string) => string; eventName: (id: string) => string; shares?: ReadonlyMap<string, number> }): Process {
  const lifelines = laneOrder(flow)
    .filter((id) => id !== OUTCOMES_LANE)
    .map((id) => ({ id, name: options.serviceName(id) }));
  const stepOf = new Map(flow.steps.map((s) => [s.id, s]));
  const outcomeOf = new Map(flow.outcomes.map((o) => [o.id, o]));
  const visited = new Set<string>();
  const shares = options.shares ?? new Map<string, number>();

  const stepItems = (step: FlowStep): ProcessItem[] => {
    if (visited.has(step.id)) return [{ kind: 'note', id: `again:${step.id}:${visited.size}`, at: step.serviceDefinitionId, text: `continues at ${step.name}` }];
    visited.add(step.id);
    const items: ProcessItem[] = [];
    if (step.kind === 'wait') items.push({ kind: 'note', id: `wait:${step.id}`, at: step.serviceDefinitionId, text: `${step.name}: wait${step.deadlineMs !== undefined ? ` ≤ ${formatWait(step.deadlineMs)}` : ''}` });
    const out = flow.transitions.filter((t) => t.from === step.id);
    const conditional = out.filter((t) => t.condition !== undefined);
    const unconditional = out.filter((t) => t.condition === undefined);
    // The flow model: unconditional exits always run (together when several); a conditional exit
    // runs when its condition holds. Only a step whose exits are all conditional chooses (alt).
    if (unconditional.length > 1) items.push({ kind: 'fragment', id: `par:${step.id}`, type: 'par', sections: unconditional.map((t) => ({ items: transitionItems(step, t) })) });
    else for (const t of unconditional) items.push(...transitionItems(step, t));
    const sections = (ts: FlowTransition[]): Section[] => ts.map((t) => ({ guard: t.condition, share: shares.get(t.id), items: transitionItems(step, t) }));
    if (conditional.length > 1 && unconditional.length === 0) items.push({ kind: 'fragment', id: `alt:${step.id}`, type: 'alt', sections: sections(conditional) });
    else for (const t of conditional) items.push({ kind: 'fragment', id: `opt:${t.id}`, type: 'opt', guard: t.condition, sections: sections([t]) });
    return items;
  };

  const transitionItems = (from: FlowStep, t: FlowTransition): ProcessItem[] => {
    const outcome = outcomeOf.get(t.to);
    if (outcome) return [{ kind: 'note', id: `end:${t.id}`, at: from.serviceDefinitionId, text: `⊣ ${outcome.name} (${outcome.kind})` }];
    const to = stepOf.get(t.to);
    if (!to) return [];
    const repeat = t.policies.find((p) => (p.type === 'retry' || p.type === 'redelivery') && p.state !== 'missing');
    const guards = t.policies.filter((p) => p !== repeat).map(flowGuard);
    const via = t.via.kind === 'event' ? options.eventName(t.via.eventTypeId) : t.via.kind;
    const message: ProcessItem = { kind: 'message', id: `t:${t.id}`, from: from.serviceDefinitionId, to: to.serviceDefinitionId, label: `${to.name} (${via})`, style: t.via.kind === 'event' ? 'async' : t.via.kind === 'local' ? 'local' : 'call', guards };
    const sent: ProcessItem = repeat ? { kind: 'fragment', id: `loop:${t.id}`, type: 'loop', guard: repeat.label, sections: [{ guard: repeat.label, items: [message] }] } : message;
    const body = [sent, ...stepItems(to)];
    return to.kind === 'compensation' ? [{ kind: 'fragment', id: `undo:${t.id}`, type: 'compensation', guard: `undo with ${to.name}`, sections: [{ items: body }] }] : body;
  };

  const start = stepOf.get(flow.startStepId);
  const trigger = flow.trigger.kind === 'event' ? `on event ${flow.trigger.ref ?? ''}`.trim() : flow.trigger.kind === 'call' ? `on call${flow.trigger.ref ? ` from ${options.serviceName(flow.trigger.ref)}` : ''}` : `on ${flow.trigger.kind}`;
  const items: ProcessItem[] = start ? [{ kind: 'note', id: 'start', at: start.serviceDefinitionId, text: `${start.name} (${trigger})` }, ...stepItems(start)] : [];
  return { lifelines, items };
}

const flowGuard = (p: FlowPolicy) => (p.state === 'missing' ? `${p.label} (missing)` : p.label);
const formatWait = (ms: number) => (ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 1000)} s`);

/** Every fragment of a process, depth first (for tests and summaries). */
export function fragmentsOf(items: readonly ProcessItem[]): Extract<ProcessItem, { kind: 'fragment' }>[] {
  return items.flatMap((item) => (item.kind === 'fragment' ? [item, ...item.sections.flatMap((s) => fragmentsOf(s.items))] : []));
}
