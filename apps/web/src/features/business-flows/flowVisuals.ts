import type { BusinessFlow } from '../../domain/types';
import type { FlowBoardIndex } from '../../transit/flows/flowIndex';

/** Token colour of a flow line: the transit board's categorical palette by global (name) order. */
export function flowColor(fx: FlowBoardIndex, flowId: string): string {
  const position = fx.flows.findIndex((f) => f.id === flowId);
  return `var(--transit-line-${(Math.max(0, position) % 12) + 1})`;
}

/** A transition on an undo track: into or out of a compensation step. */
export function isUndoTransition(flow: BusinessFlow, transitionId: string): boolean {
  const t = flow.transitions.find((x) => x.id === transitionId);
  if (!t) return false;
  const kind = (id: string) => flow.steps.find((s) => s.id === id)?.kind;
  return kind(t.to) === 'compensation' || kind(t.from) === 'compensation';
}

/** Keeps the shared view state, drops the flow board's own parameters. */
export const stripPageParams = (search: string) => {
  const p = new URLSearchParams(search);
  for (const name of ['step', 'mode', 'tx', 't']) p.delete(name);
  const out = p.toString();
  return out ? `?${out}` : '';
};
