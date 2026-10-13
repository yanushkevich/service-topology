import { describe, expect, it } from 'vitest';
import { checkoutFlow, refundFlow } from '../data/mock/businessFlows';
import { mockTopology } from '../data/mock/topology';
import { indexBoard } from './board';
import { paymentServiceBoard } from './mock/paymentServiceBoard';
import { flowProcess, fragmentsOf, lineProcess, type ProcessItem } from './process';

const index = indexBoard(paymentServiceBoard('production'));
const line = (id: string) => lineProcess(index, index.lineById.get(id)!);
const names = new Map(mockTopology.serviceDefinitions.map((d) => [d.id, d.name]));
const events = new Map((mockTopology.eventTypes ?? []).map((e) => [e.id, e.name]));
const options = { serviceName: (id: string) => names.get(id) ?? id, eventName: (id: string) => events.get(id) ?? id };
const messages = (items: readonly ProcessItem[]): string[] =>
  items.flatMap((i) => (i.kind === 'message' ? [i.label] : i.kind === 'fragment' ? i.sections.flatMap((s) => messages(s.items)) : []));
const shape = (items: readonly ProcessItem[]) => fragmentsOf(items).map((f) => [f.type, f.guard ?? null, f.sections.map((s) => s.guard ?? null)]);

describe('process view of a service-board line (ADR-028)', () => {
  it('starts with the endpoint call and ends with the reply', () => {
    const capture = line('A2');
    expect(capture.lifelines[0]?.name).toBe('Order Service');
    const all = messages(capture.items);
    expect(all[0]).toBe('rpc Capture(CaptureRequest) returns (Payment)');
    expect(all.at(-1)).toBe('reply');
  });

  it('loops the retried card call and groups the table writes in one transaction (Capture)', () => {
    const capture = line('A2');
    expect(shape(capture.items)).toEqual([
      ['loop', 'retry ×3', ['retry ×3']],
      ['transaction', 'one transaction', [null]],
    ]);
    const tx = fragmentsOf(capture.items).find((f) => f.type === 'transaction')!;
    expect(messages(tx.sections[0]!.items)).toEqual(['write payments', 'write payment_outbox (transactional outbox)']);
    // Other client policies guard the call; the retry is the loop.
    const card = capture.items.find((i) => i.kind === 'fragment' && i.type === 'loop');
    const call = card?.kind === 'fragment' ? card.sections[0]?.items[0] : undefined;
    expect(call?.kind === 'message' ? call.guards : []).toEqual(['bulkhead 20', '2 s', 'breaker']);
  });

  it('draws an alternative branch as opt with its condition and share (GetPayment)', () => {
    expect(shape(line('A5').items)).toContainEqual(['opt', 'cache miss', ['cache miss']]);
    const opt = fragmentsOf(line('A5').items).find((f) => f.type === 'opt')!;
    expect(opt.sections[0]?.share).toBe(0.06);
  });

  it('wraps a repeating line in a loop (OutboxRelay) and parallel forks in par (ReconcileSettlements)', () => {
    expect(shape(line('O1').items)[0]).toEqual(['loop', 'every 200 ms', ['every 200 ms']]);
    expect(messages(line('O1').items)).toContain('read payment_outbox (transactional outbox)');
    const par = fragmentsOf(line('J2').items).find((f) => f.type === 'par')!;
    expect(par.sections.map((s) => messages(s.items))).toEqual([
      ['call through card client', 'call Card Processor'],
      ['call through ledger client', 'call Ledger'],
    ]);
  });
});

describe('process view of a business flow (ADR-028)', () => {
  const checkout = flowProcess(checkoutFlow, options);

  it('uses the swimlane’s service order for lifelines', () => {
    expect(checkout.lifelines.map((l) => l.name)).toEqual(['Order Service', 'Inventory Service', 'Payment Service', 'Notification Service', 'Ledger Service', 'Email Dispatcher']);
  });

  it('draws decisions as alt, with else for the unconditional exit', () => {
    const fragments = shape(checkout.items);
    expect(fragments).toContainEqual(['alt', null, ['approved', 'declined']]);
    expect(fragments).toContainEqual(['alt', null, ['not settled in 10 min', 'else']]);
  });

  it('draws unconditional exits that run together as par, redelivery as loop, and compensation as its own fragment', () => {
    const fragments = shape(checkout.items);
    expect(fragments.some(([type]) => type === 'par')).toBe(true);
    expect(fragments).toContainEqual(['loop', 'redelivery ×5', ['redelivery ×5']]);
    expect(fragments).toContainEqual(['compensation', 'undo with Void authorization', [null]]);
  });

  it('ends sections at outcomes and does not repeat a step reached twice', () => {
    const notes = (items: readonly ProcessItem[]): string[] => items.flatMap((i) => (i.kind === 'note' ? [i.text] : i.kind === 'fragment' ? i.sections.flatMap((s) => notes(s.items)) : []));
    const all = notes(checkout.items);
    expect(all[0]).toBe('Place order (on call from API Gateway)');
    expect(all).toContain('⊣ Completed (success)');
    expect(all).toContain('continues at Cancel order');
    expect(all.some((n) => n.startsWith('Await settlement: wait ≤ 10 min'))).toBe(true);
    // Two transitions lead to Cancel order (declined; not settled in time), but its own exits are drawn once.
    expect(messages(checkout.items).filter((m) => m.startsWith('Cancel order')).length).toBe(2);
    expect(messages(checkout.items).filter((m) => m.startsWith('Release stock')).length).toBe(1);
    expect(shape(flowProcess(refundFlow, options).items)).toContainEqual(['alt', null, ['refund accepted', 'processor declined']]);
  });
});
