import { useId } from 'react';
import { Link, useLocation } from 'react-router';
import { formatMs, formatRate, type BoardIndex } from '../../transit/board';
import { flowLinesSummary, type StepLineRow } from '../../transit/flows/flowLines';
import { cx, kickerClass } from '../../shared/ui/classes';
import { StopStrip } from '../transit-board/StopStrip';
import { LineBadge } from '../transit-board/visuals';
import { policyText, serviceBoardLink, STEP_LINE_STATUS } from './flowLinesText';

/**
 * Which line each step uses (Milestone 13.2): the flow board's Lines strip — a table of every step
 * with the line it enters on its service's board (or why it has none), and the selected step's line
 * as the service board's stop strip — and the step card's Inside-the-service block.
 */
export function FlowLinesView({ rows, boards, flowId, selectedStepId, onSelectStep }: { rows: readonly StepLineRow[]; boards: ReadonlyMap<string, BoardIndex | null>; flowId: string; selectedStepId: string | null; onSelectStep: (stepId: string) => void }) {
  const { search } = useLocation();
  const summary = flowLinesSummary(rows);
  const selected = rows.find((r) => r.stepId === selectedStepId);
  const index = selected?.line ? boards.get(selected.serviceDefinitionId) : undefined;
  const line = index && selected?.line ? index.lines.find((l) => l.id === selected.line?.id) : undefined;
  return (
    <div className="flex flex-col gap-2.5" data-flow-lines>
      <p className="m-0 text-sm text-fg-2">
        <b className="text-fg">{summary.mapped}</b> of {summary.steps} steps enter a known line, on {summary.boards} of {summary.services} services’ boards.
        {summary.noBoard > 0 && ` ${summary.noBoard} step${summary.noBoard === 1 ? ' is' : 's are'} in services without a board.`}
        {summary.unmatched > 0 && ` ${summary.unmatched} step${summary.unmatched === 1 ? '' : 's'} match no line.`}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-sm" aria-label="Which line each step uses">
          <thead>
            <tr className={cx(kickerClass, 'text-left')}>
              <th scope="col" className="py-1 pr-3 font-normal">Step</th>
              <th scope="col" className="py-1 pr-3 font-normal">Service</th>
              <th scope="col" className="py-1 pr-3 font-normal">Line</th>
              <th scope="col" className="py-1 pr-3 font-normal">Goes to</th>
              <th scope="col" className="py-1 pr-3 font-normal">Policies</th>
              <th scope="col" className="py-1 text-right font-normal">p95 · errors</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <LinesRow key={row.stepId} row={row} index={boards.get(row.serviceDefinitionId) ?? null} selected={row.stepId === selectedStepId} onSelect={onSelectStep} />
            ))}
          </tbody>
        </table>
      </div>
      {selected && line && index ? (
        <>
          <StopStrip index={index} line={line} focusStations={new Set()} />
          <Link to={serviceBoardLink(selected, flowId, search)} className="self-start text-xs text-accent-fg underline">
            Open line {line.code} on the {selected.serviceName} board
          </Link>
        </>
      ) : (
        <p className="m-0 text-xs text-fg-3">{selected ? `${selected.stepName}: ${STEP_LINE_STATUS[selected.status === 'mapped' ? 'no-line' : selected.status].fix}` : 'Select a step to see its line stop by stop.'}</p>
      )}
    </div>
  );
}

function LinesRow({ row, index, selected, onSelect }: { row: StepLineRow; index: BoardIndex | null; selected: boolean; onSelect: (stepId: string) => void }) {
  const { line } = row;
  return (
    <tr className={cx('border-t border-line align-top', selected && 'bg-accent-soft', !row.typical && 'text-fg-2')} data-step-line={row.stepId} data-status={row.status}>
      <td className="py-1.5 pr-3">
        <button type="button" className="min-h-6 text-left font-medium text-fg hover:underline aria-pressed:font-semibold" aria-pressed={selected} onClick={() => onSelect(row.stepId)}>
          {row.stepName}
        </button>
        {!row.typical && <span className="ml-1.5 text-xs text-fg-3">off the typical path</span>}
      </td>
      <td className="py-1.5 pr-3 whitespace-nowrap">{row.serviceName}</td>
      <td className="py-1.5 pr-3">
        {line && index ? (
          <span className="flex items-start gap-2">
            <LineBadge index={index} lineId={line.id} code={line.code} />
            <span className="min-w-0">
              <span className="block">{line.name}</span>
              <span className="block font-mono text-[11px] text-fg-3">{line.signature}</span>
            </span>
          </span>
        ) : (
          <span className="text-fg-3">
            {row.status !== 'mapped' && STEP_LINE_STATUS[row.status].label}
            {row.entryPoint && <span className="block font-mono text-[11px]">{row.entryPoint}</span>}
          </span>
        )}
      </td>
      <td className="py-1.5 pr-3">{line ? line.dependencies.map((d) => d.name).join(', ') || '—' : ''}</td>
      <td className="py-1.5 pr-3 whitespace-nowrap">
        {line && (
          <>
            {line.policies.total}
            {line.policies.missing > 0 && <span className="ml-1 text-warn-fg">· {line.policies.missing} missing</span>}
          </>
        )}
      </td>
      <td className="py-1.5 text-right font-mono whitespace-nowrap">{line ? `${formatMs(line.p95Ms)} · ${formatRate(line.errorRate)}` : ''}</td>
    </tr>
  );
}

/** The step card's drill-down: what the step does inside its service, stop by stop, and the way to the board. */
export function StepInside({ row, flowId }: { row: StepLineRow; flowId: string }) {
  const { search } = useLocation();
  const id = useId();
  const { line } = row;
  return (
    <section aria-labelledby={id} className="mt-2 border-t border-accent-ring pt-2" data-step-inside={row.stepId}>
      <h4 id={id} className={cx(kickerClass, 'm-0 mb-1')}>
        Inside {row.serviceName}
      </h4>
      {line ? (
        <>
          <p className="m-0 text-xs text-fg">
            Line <b>{line.code}</b> {line.name} · <span className="font-mono text-fg-2">{line.signature}</span>
          </p>
          <ol aria-label={`Route of line ${line.code}`} className="m-0 mt-1 flex list-none flex-col gap-0.5 p-0 text-xs">
            {line.stops.map((stop) =>
              'station' in stop ? (
                <li key={stop.station.id} className="flex gap-1.5">
                  <span aria-hidden="true" className="text-fg-3">
                    ●
                  </span>
                  <span className="text-fg">{stop.station.name}</span>
                  <span className="text-fg-3">{stop.station.kind}</span>
                </li>
              ) : (
                <li key={stop.stop.id} className={cx('flex gap-1.5 pl-3', stop.stop.state === 'missing' ? 'text-warn-fg' : 'text-fg-2')}>
                  <span aria-hidden="true">◆</span>
                  {policyText(stop.stop)}
                  {stop.stop.state === 'missing' && ' (missing)'}
                </li>
              ),
            )}
          </ol>
          <Link to={serviceBoardLink(row, flowId, search)} className="mt-1.5 inline-block text-xs text-accent-fg underline">
            Open line {line.code} on the {row.serviceName} board
          </Link>
        </>
      ) : (
        <>
          <p className="m-0 text-xs text-fg-2">{row.status !== 'mapped' && STEP_LINE_STATUS[row.status].fix}</p>
          <Link to={serviceBoardLink(row, flowId, search)} className="mt-1.5 inline-block text-xs text-accent-fg underline">
            Open the {row.serviceName} board
          </Link>
        </>
      )}
    </section>
  );
}
