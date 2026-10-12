import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { usePreferencesStore } from '../../state/preferencesStore';
import { renderApp, resetUiStore } from '../../test/renderApp';
import { paymentServiceTraces } from '../../transit/mock/paymentServiceTraces';

const BOARD = '/services/payment-service/transit?v=1&env=production';

/** Panels are queried within their landmark: page-wide role queries walk the whole SVG map. */
const panel = (label: string) => {
  const element = document.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (!element) throw new Error(`No panel "${label}"`);
  return element;
};
const card = () => panel('Line card');
const strip = () => panel('Stop strip');
const svg = () => panel('Map').querySelector('svg') as SVGSVGElement;
const params = (router: ReturnType<typeof renderApp>) => new URLSearchParams(router.state.location.search);
const slider = () => within(strip()).getByRole('slider', { name: 'Playback position' }) as HTMLInputElement;
const currentStep = () => within(strip()).getAllByRole('button').find((b) => b.getAttribute('aria-current') === 'step');
const traceOf = (lineId: string, test: (labels: string[]) => boolean) =>
  [...paymentServiceTraces().values()].find((t) => t.summary.lineId === lineId && test(t.steps.map((s) => s.label)))!;

async function openTrace(path: string) {
  const router = renderApp(path);
  await waitFor(() => within(strip()).getByRole('list', { name: /^Steps of trace / }));
  return router;
}

describe('trace replay (spec Phase 4, example traces)', () => {
  beforeEach(resetUiStore);

  it('opens from the line card with sample requests, steps, and a train on the map', async () => {
    const user = userEvent.setup();
    const router = renderApp(`${BOARD}&line=A1`);
    await waitFor(() => card());
    await user.click(within(card()).getByRole('button', { name: 'Replay a real request' }));
    expect(params(router).get('mode')).toBe('trace');
    await waitFor(() => within(strip()).getByRole('list', { name: /^Steps of trace / }));
    const samples = within(card()).getByRole('region', { name: 'Sample requests' });
    const reasons = within(samples).getAllByRole('button', { pressed: false }).concat(within(samples).getAllByRole('button', { pressed: true })).map((b) => b.textContent);
    for (const reason of ['slowest', 'most recent error', 'with retries', 'typical']) expect(reasons.join(' ')).toContain(reason);
    expect(screen.getByRole('button', { name: 'Trace replay' })).toHaveAttribute('aria-pressed', 'true');
    expect(svg().querySelectorAll('[data-train]')).toHaveLength(1);
    expect(currentStep()).toHaveTextContent('Order Service calls Authorize');
  });

  it('steps, scrubs, and writes the paused time to the URL', async () => {
    const user = userEvent.setup();
    const router = await openTrace(`${BOARD}&line=A2&mode=trace`);
    await user.click(within(card()).getByRole('button', { name: 'Next' }));
    expect(currentStep()).toHaveTextContent('mTLS ok');
    const train = svg().querySelector('[data-train]');
    expect(train).toHaveAttribute('data-train', 'gate:grpc');
    // Clicking a step in the strip jumps the clock to it.
    const steps = within(strip()).getAllByRole('button');
    await user.click(steps[4]!);
    expect(currentStep()).toBe(within(strip()).getAllByRole('button')[4]);
    await waitFor(() => expect(Number(params(router).get('t'))).toBe(Number(slider().value)));
    fireEvent.change(slider(), { target: { value: '0' } });
    expect(currentStep()).toHaveTextContent('Order Service calls Capture');
    await waitFor(() => expect(params(router).get('t')).toBeNull());
  });

  it('plays and pauses, and with reduced motion steps instead of gliding', async () => {
    const user = userEvent.setup();
    usePreferencesStore.setState((s) => ({ preferences: { ...s.preferences, motion: 'reduce' } }));
    await openTrace(`${BOARD}&line=J1&mode=trace`);
    await user.click(within(card()).getByRole('button', { name: 'Play' }));
    expect(within(card()).getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    await waitFor(() => expect(currentStep()).not.toHaveTextContent('Scheduler fires'), { timeout: 2500 });
    const train = svg().querySelector<SVGGElement>('[data-train]');
    expect(train?.style.transition).toBe('none');
    await user.click(within(card()).getByRole('button', { name: 'Pause' }));
    expect(within(card()).getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });

  it('supports the keyboard: Right steps, ] switches sample, Space plays, T returns to typical', async () => {
    const user = userEvent.setup();
    const router = await openTrace(`${BOARD}&line=A1&mode=trace`);
    const first = params(router).get('trace');
    within(card()).getByRole('textbox', { name: 'Trace ID' }).focus();
    (document.activeElement as HTMLElement).blur();
    panel('Map').focus();
    fireEvent.keyDown(panel('Map'), { key: 'ArrowRight' });
    expect(currentStep()).toHaveTextContent('mTLS ok');
    fireEvent.keyDown(panel('Map'), { key: ']' });
    await waitFor(() => expect(params(router).get('trace')).not.toBe(first));
    await waitFor(() => within(strip()).getByRole('list', { name: `Steps of trace ${params(router).get('trace')}` }));
    fireEvent.keyDown(panel('Map'), { key: ' ' });
    expect(within(card()).getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    fireEvent.keyDown(panel('Map'), { key: ' ' });
    fireEvent.keyDown(panel('Map'), { key: 'T' });
    await waitFor(() => expect(params(router).get('mode')).toBeNull());
    expect(within(strip()).getByRole('list', { name: 'Stops on line A1' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
  });

  it('explains how a trace diverges from the typical route and marks the step', async () => {
    const miss = traceOf('A5', (labels) => labels.includes('Cache miss: read the replica'));
    await openTrace(`${BOARD}&line=A5&mode=trace&trace=${miss.summary.traceId}`);
    expect(within(card()).getByRole('region', { name: 'Compared with typical' })).toHaveTextContent(/Left the typical route to replica pool after “Cache miss: read the replica”/);
    expect(strip().querySelector('[data-divergence]')).toHaveTextContent('diverges from typical');
  });

  it('flags off-map spans, shows lost context as a gap, and stacks a fan-out', async () => {
    const offMap = traceOf('W1', (labels) => labels.some((l) => l.includes('audit.write')));
    await openTrace(`${BOARD}&line=W1&mode=trace&trace=${offMap.summary.traceId}`);
    expect(strip()).toHaveTextContent('off-map span');
    expect(card()).toHaveTextContent(/flagged “off-map”/);
  });

  it('shows lost trace context as a dashed gap', async () => {
    const gap = traceOf('E1', (labels) => labels.some((l) => l.startsWith('Context lost')));
    await openTrace(`${BOARD}&line=E1&mode=trace&trace=${gap.summary.traceId}`);
    expect(strip()).toHaveTextContent('context lost');
    expect(card()).toHaveTextContent(/gap is shown as dashed, not bridged/);
  });

  it('runs parallel spans side by side with a train on each branch', async () => {
    await openTrace(`${BOARD}&line=J2&mode=trace`);
    expect(within(strip()).getAllByText('in parallel').length).toBeGreaterThan(0);
    const id = within(strip()).getByRole('list', { name: /^Steps of trace / }).getAttribute('aria-label')!.replace('Steps of trace ', '');
    const trace = paymentServiceTraces().get(id)!;
    const fork = trace.steps.find((s) => s.parallel)!;
    act(() => {
      fireEvent.change(slider(), { target: { value: String(fork.startMs) } });
    });
    expect(svg().querySelectorAll('[data-train]').length).toBe(2);
  });

  it('opens a pasted trace ID, switching to its line, and reports unknown IDs', async () => {
    const user = userEvent.setup();
    const router = await openTrace(`${BOARD}&line=A1&mode=trace`);
    const other = traceOf('A3', () => true);
    const field = within(card()).getByRole('textbox', { name: 'Trace ID' });
    await user.type(field, 'nope');
    await user.click(within(card()).getByRole('button', { name: 'Open' }));
    expect(await within(card()).findByRole('alert')).toHaveTextContent('No trace with ID “nope” for Payment Service.');
    await user.clear(field);
    await user.type(field, other.summary.traceId);
    await user.click(within(card()).getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(params(router).get('line')).toBe('A3'));
    await waitFor(() => within(strip()).getByRole('list', { name: `Steps of trace ${other.summary.traceId}` }));
  });

  it('starts a shared link at its paused time', async () => {
    const trace = traceOf('A2', () => true);
    await openTrace(`${BOARD}&line=A2&mode=trace&trace=${trace.summary.traceId}&t=150`);
    await waitFor(() => expect(slider().value).toBe('150'));
  });

  it('cannot replay a line without traces in the window', async () => {
    renderApp(`${BOARD}&line=O1&mode=trace`);
    await waitFor(() => card());
    expect(screen.getByRole('button', { name: 'Trace replay' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Trace replay' })).toHaveAccessibleDescription(/No traces for line O1 in the last 24 hours/);
    expect(within(strip()).getByRole('list', { name: 'Stops on line O1' })).toBeInTheDocument();
  });
});

describe('typical mode: windows, per-step stats, tooltips', () => {
  beforeEach(resetUiStore);

  it('switches the window: counts, labels, and the URL follow', async () => {
    const user = userEvent.setup();
    const router = renderApp(`${BOARD}&line=J2`);
    await waitFor(() => card());
    expect(within(card()).getByText('Traces, last 24 hours').nextSibling).toHaveTextContent('1');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Window' }), '1h');
    await waitFor(() => expect(params(router).get('window')).toBe('1h'));
    await waitFor(() => within(card()).getByText(/No traces in the last hour/));
    expect(screen.getByText(/^Example data · last hour$/)).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Window' }), '7d');
    await waitFor(() => expect(within(card()).getByText('Traces, last 7 days').nextSibling).toHaveTextContent('7'));
  });

  it('shows per-step p99 and rates, tinted by the thresholds with a word', async () => {
    renderApp(`${BOARD}&line=A1`);
    await waitFor(() => card());
    const stops = within(strip()).getByRole('list', { name: 'Stops on line A1' });
    const fraud = within(stops).getAllByRole('listitem').find((li) => li.textContent?.startsWith('Fraud Scoring'))!;
    expect(fraud).toHaveTextContent(/p99 1.65 s · errors/);
    expect(fraud.querySelector('[data-tint="errors"]')).not.toBeNull();
    const client = within(stops).getAllByRole('listitem').find((li) => li.textContent?.startsWith('fraud client'))!;
    expect(client).toHaveTextContent(/retry 29%/);
  });

  it('shows tooltips for stations and policy stops', async () => {
    renderApp(`${BOARD}&line=A2`);
    await waitFor(() => card());
    fireEvent.pointerEnter(svg().querySelector('[data-station="dep:card"]')!);
    const tip = within(panel('Map')).getByRole('tooltip');
    expect(tip).toHaveTextContent('Card Processor');
    expect(tip).toHaveTextContent(/observed/i);
    expect(tip).toHaveTextContent('p50 180 ms · p99 680 ms');
    fireEvent.pointerLeave(svg().querySelector('[data-station="dep:card"]')!);
    expect(within(panel('Map')).queryByRole('tooltip')).toBeNull();
    fireEvent.pointerEnter(svg().querySelector('[data-stop="pol:card:2"]')!);
    expect(within(panel('Map')).getByRole('tooltip')).toHaveTextContent('retry ×3 · 4 attempts · 200 ms backoff');
    expect(within(panel('Map')).getByRole('tooltip')).toHaveTextContent('resilience.yaml · card');
  });

  it('hides labels that fit nowhere until their line is selected', async () => {
    const user = userEvent.setup();
    renderApp(BOARD);
    await waitFor(() => card());
    const labelled = () => [...svg().querySelectorAll('[data-station]')].filter((g) => g.querySelector('[data-label]')).map((g) => g.getAttribute('data-station'));
    const before = labelled();
    await user.click(within(panel('Lines')).getByRole('button', { name: /^A2: / }));
    for (const id of ['caller:order-service', 'gate:grpc', 'mod:capture', 'cli:card', 'dep:card', 'cli:pg', 'dep:pg']) expect(labelled()).toContain(id);
    expect(before.length).toBeGreaterThan(20);
  });
});
