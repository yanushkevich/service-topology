import { describe, expect, it } from 'vitest';
import { checkoutFlow, refundFlow } from '../../data/mock/businessFlows';
import { exampleFlowStats, exampleTransactions } from './exampleFlows';
import { flowBudget, flowFindings, flowSearchText, stages, typicalPath } from './flowModel';
import { activeTxSteps, sampleTransactions, txDivergence } from './observed';

const shares = new Map(Object.entries(exampleFlowStats('flow-checkout', '24h')!.transitions));

describe('flow model (ADR-022)', () => {
  it('groups steps into stages by rank', () => {
    const s = stages(checkoutFlow);
    expect(s[0]!.steps.map((x) => x.id)).toEqual(['place-order']);
    expect(s.flatMap((x) => x.steps).length).toBe(checkoutFlow.steps.length);
    expect(s.flatMap((x) => x.outcomes).length).toBe(checkoutFlow.outcomes.length);
  });

  it('follows unconditional exits and, at decisions, the most frequent one', () => {
    const { steps } = typicalPath(checkoutFlow, shares);
    expect(steps).toEqual(['place-order', 'reserve-stock', 'authorize-payment', 'capture-payment', 'ship-order', 'await-settlement', 'notify-customer', 'post-to-ledger', 'send-email']);
    expect(steps).not.toContain('cancel-order'); // an exception from Await settlement, never typical
    // Without shares, a decision takes its first conditional exit.
    expect(typicalPath(refundFlow).steps).toEqual(['request-refund', 'refund-payment', 'post-refund']);
  });

  it('budgets timeouts × attempts and deadlines on the typical path, waits excluded', () => {
    const budget = flowBudget(checkoutFlow, shares)!;
    expect(budget.segments.map((s) => [s.stepId, s.ms])).toEqual([
      ['reserve-stock', 2000],
      ['authorize-payment', 9000],
      ['capture-payment', 3000],
      ['ship-order', 9000],
    ]);
    expect(budget.overflowMs).toBe(23_000 - 4000);
    expect(flowBudget({ ...checkoutFlow, target: {} })).toBeNull();
  });

  it('finds retry amplification across levels, missing compensation, missing DLQs, and deadline overruns', () => {
    const findings = flowFindings(checkoutFlow, {
      shares,
      eventName: (id) => ({ 'event-order-placed': 'OrderPlaced' })[id] ?? id,
      serviceName: (id) => ({ 'order-service': 'Order Service' })[id] ?? id,
      innerAttempts: (step) => (step.entryPoint === 'Authorize' ? { attempts: 4, what: 'the card client' } : null),
    });
    const by = (rule: string) => findings.filter((f) => f.ruleId === rule).map((f) => f.text);
    expect(by('retry-amplification')).toEqual(['Authorize payment: Order Service retries 3× and the card client retries 4× inside: up to 12 calls per checkout.']);
    expect(by('missing-compensation')).toEqual(['Capture payment is not undone when the flow ends Cancelled: it has no compensation step.']);
    expect(by('event-without-dead-letter')).toEqual(expect.arrayContaining([expect.stringMatching(/^OrderPlaced \(Place order → Reserve stock\) has no dead-letter queue/)]));
    expect(by('event-without-dead-letter').some((t) => t.startsWith('event-notification-requested'))).toBe(false); // that hand-off has a DLQ
    expect(by('deadline-over-target')).toEqual(['Timeouts and deadlines on the typical path add up to 23 s, above the 4 s target.']);
    expect(by('missing-policy').length).toBeGreaterThan(0);
    expect(findings.every((f) => f.severity === 'warn' || f.ruleId === 'missing-policy')).toBe(true);
  });

  it('searches flows by step, service, and event', () => {
    const text = flowSearchText(checkoutFlow, (id) => id.replace('-', ' '), (id) => (id === 'event-order-shipped' ? 'OrderShipped' : id));
    expect(text).toContain('capture payment');
    expect(text).toContain('ordershipped');
    expect(text).toContain('ledger service');
  });
});

describe('example business transactions', () => {
  const txs = exampleTransactions(checkoutFlow);

  it('use only the flow’s steps and transitions, in replay order', () => {
    expect(txs.length).toBe(8);
    for (const tx of txs) {
      for (const s of tx.steps) {
        expect(checkoutFlow.steps.some((x) => x.id === s.stepId)).toBe(true);
        if (s.transitionId) expect(checkoutFlow.transitions.some((t) => t.id === s.transitionId)).toBe(true);
      }
      const starts = tx.steps.map((s) => s.displayStartMs);
      expect(starts).toEqual([...starts].sort((a, b) => a - b));
    }
  });

  it('compress waits, mark gaps, dead letters, compensation, retries, and link payment traces', () => {
    const timeout = txs.find((t) => t.key === 'order 4466')!;
    const wait = timeout.steps.find((s) => s.stepId === 'await-settlement')!;
    expect(wait.durationMs).toBe(600_000);
    expect(wait.displayDurationMs).toBeLessThan(wait.durationMs);
    expect(timeout.compensated).toBe(true);
    expect(timeout.outcomeKind).toBe('cancelled');
    expect(txs.find((t) => t.key === 'order 4450')!.steps.some((s) => !s.correlated)).toBe(true);
    expect(txs.find((t) => t.key === 'order 4458')!.steps.some((s) => s.deadLetter === 'dropped')).toBe(true);
    expect(txs.find((t) => t.key === 'order 4479')!.retries).toBe(2);
    expect(timeout.steps.find((s) => s.stepId === 'capture-payment')!.trace).toMatchObject({ serviceDefinitionId: 'payment-service', lineId: 'A2' });
    // Parallel lanes: shipping and settlement start together after the capture.
    const typical = txs.find((t) => t.key === 'order 4486')!;
    const ship = typical.steps.find((s) => s.stepId === 'ship-order')!;
    const settle = typical.steps.find((s) => s.stepId === 'await-settlement')!;
    expect(ship.startMs).toBe(settle.startMs);
    expect(activeTxSteps(typical.steps, settle.displayStartMs + 1, typical.steps.indexOf(ship)).length).toBe(2);
  });

  it('samples slowest, failed, compensated, with retries, and typical, and finds divergence', () => {
    const stats = exampleFlowStats('flow-checkout', '24h');
    const reasons = sampleTransactions(txs, stats).flatMap((s) => s.reasons);
    expect(reasons).toEqual(expect.arrayContaining(['slowest', 'failed', 'compensated', 'with retries', 'typical']));
    const typical = typicalPath(checkoutFlow, shares).steps;
    const timeout = txs.find((t) => t.key === 'order 4466')!;
    expect(txDivergence(checkoutFlow, timeout, typical)?.text).toMatch(/^Left the typical path to Cancel order after “No settlement webhook within 10 min”/);
    expect(txDivergence(checkoutFlow, txs.find((t) => t.key === 'order 4437')!, typical)).toBeNull();
  });

  it('scale statistics by window', () => {
    expect(exampleFlowStats('flow-checkout', '7d')!.transactions).toBe(176_000);
    expect(exampleFlowStats('flow-checkout', '1h')!.transactions).toBe(1048);
    expect(exampleFlowStats('nope', '24h')).toBeNull();
  });
});

describe('flows on a service board (ADR-023)', () => {
  const lines = [
    { id: 'A1', name: 'Authorize', signature: 'rpc Authorize(AuthorizeRequest) returns (Authorization)' },
    { id: 'A2', name: 'Capture', signature: 'rpc Capture(CaptureRequest) returns (Payment)' },
  ];
  it('matches a step to the line its entry point names, ignoring case, and reports unmapped steps', async () => {
    const { flowsOnService, lineForStep } = await import('./flowModel');
    expect(lineForStep(lines, { id: 's', name: 'S', serviceDefinitionId: 'payment-service', kind: 'task', entryPoint: 'capture' })?.id).toBe('A2');
    expect(lineForStep(lines, { id: 's', name: 'S', serviceDefinitionId: 'payment-service', kind: 'task' })).toBeNull();
    const [checkout] = flowsOnService([checkoutFlow, refundFlow], 'payment-service', lines);
    expect(checkout?.flow.id).toBe('flow-checkout');
    expect(checkout?.steps.map((s) => [s.step.id, s.lineId])).toEqual([
      ['authorize-payment', 'A1'],
      ['capture-payment', 'A2'],
      ['await-settlement', null],
      ['void-authorization', null],
    ]);
    expect(flowsOnService([checkoutFlow], 'no-such-service', lines)).toEqual([]);
  });
});
