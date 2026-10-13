import { Canvas } from '@react-three/fiber';
import { Component, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { BusinessFlow } from '../../../domain/types';
import type { BoardIndex } from '../../../transit/board';
import type { TxStep } from '../../../transit/flows/observed';
import type { SwimlaneLayout } from '../../../transit/flows/swimlane';
import { buttonClass, cx, floatClass, kickerClass } from '../../../shared/ui/classes';
import { useMotionReduced } from '../../../state/motion';
import { useUiStore } from '../../../state/uiStore';
import type { Playback } from '../../boards/playback';
import { detectWebGL, watchContextLoss } from '../../service-map/galaxy/webgl';
import { buildDrilldown } from './drilldownModel';
import { readDrilldownColors } from './drilldownPalette';
import { DrilldownScene } from './DrilldownScene';

/**
 * Lazy-loaded boundary of the flow's 3D drill-down (ADR-026): WebGL detection, context-loss and
 * error fallbacks, the canvas, and the DOM overlay (where you are, the way back, and the services as
 * a list, the accessible path). The swimlane never depends on anything here.
 */
export interface FlowDrilldown3DProps {
  flow: BusinessFlow;
  layout: SwimlaneLayout;
  boards: ReadonlyMap<string, BoardIndex | null>;
  serviceName: (id: string) => string;
  scope: string | null;
  onScope: (serviceDefinitionId: string | null) => void;
  selectedStepId: string | null;
  onSelectStep: (stepId: string) => void;
  replay: { steps: readonly TxStep[]; playback: Playback } | null;
  /** Back to the 2D swimlane. */
  onExit: () => void;
}

export function FlowDrilldown3D(props: FlowDrilldown3DProps) {
  const [webgl] = useState(() => detectWebGL());
  if (!webgl) return <Fallback title="3D needs WebGL" body="This browser or device cannot create a WebGL context. The swimlane, the step strip, and each service's transit board show the same flow." onExit={props.onExit} />;
  return (
    <DrilldownErrorBoundary onExit={props.onExit}>
      <Drilldown {...props} />
    </DrilldownErrorBoundary>
  );
}

function Drilldown({ flow, layout, boards, serviceName, scope, onScope, selectedStepId, onSelectStep, replay, onExit }: FlowDrilldown3DProps) {
  const theme = useUiStore((s) => s.theme);
  const reduced = useMotionReduced();
  const colors = useMemo(() => {
    void theme; // the tokens change with the theme attribute
    return readDrilldownColors();
  }, [theme]);
  const model = useMemo(() => buildDrilldown({ flow, layout, boards, serviceName }), [flow, layout, boards, serviceName]);
  const [contextLost, setContextLost] = useState(false);
  const [canvasKey, setCanvasKey] = useState(0);
  const stopWatching = useRef<() => void>(() => {});
  useEffect(() => () => stopWatching.current(), []);
  const entered = scope ? model.boards.find((b) => b.serviceDefinitionId === scope) : undefined;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !entered) return;
    e.preventDefault();
    e.stopPropagation(); // climbing back comes before clearing the selected step
    onScope(null);
  };

  if (contextLost) {
    return <Fallback title="The 3D view lost its graphics context" body="This can happen when the GPU is reset or too many 3D views are open." onExit={onExit} onRetry={() => (setContextLost(false), setCanvasKey((k) => k + 1))} />;
  }
  return (
    <div className="relative h-[620px] overflow-hidden bg-stage bg-(image:--stage-glow) max-md:h-[480px]" role="region" aria-label={`3D drill-down of ${flow.name}`} tabIndex={0} onKeyDown={onKeyDown} data-drilldown-scope={scope ?? ''}>
      <Canvas
        key={canvasKey}
        frameloop={replay ? 'always' : 'demand'}
        camera={{ fov: 45, near: 5, far: 20000, position: [0, 1500, 1500] }}
        dpr={[1, 2]}
        aria-hidden="true"
        onCreated={({ gl }) => {
          stopWatching.current();
          stopWatching.current = watchContextLoss(gl.domElement, () => setContextLost(true), () => setContextLost(false));
        }}
      >
        <DrilldownScene
          model={model}
          colors={colors}
          scope={entered ? scope : null}
          selectedStepId={selectedStepId}
          onSelectStep={onSelectStep}
          onEnterService={(id) => onScope(id)}
          replay={replay}
          reduced={reduced}
          bloom={theme === 'dark'}
        />
      </Canvas>
      <Overlay flowName={flow.name} boards={model.boards} entered={entered?.serviceDefinitionId ?? null} enteredName={entered?.name ?? null} onScope={onScope} onExit={onExit} />
    </div>
  );
}

/** Where you are, the way back, and every service plane as a button (the keyboard and screen-reader path). */
function Overlay({ flowName, boards, entered, enteredName, onScope, onExit }: { flowName: string; boards: { serviceDefinitionId: string; name: string; hasBoard: boolean }[]; entered: string | null; enteredName: string | null; onScope: (id: string | null) => void; onExit: () => void }) {
  return (
    <>
      <nav aria-label="3D scope" className={cx(floatClass, 'top-3 left-3 z-30 flex flex-wrap items-center gap-2 px-2.5 py-1.5 text-sm')}>
        <button type="button" className="font-semibold text-fg hover:underline aria-[current=true]:no-underline" aria-current={entered ? undefined : true} onClick={() => onScope(null)}>
          {flowName}
        </button>
        {enteredName && (
          <>
            <span aria-hidden="true" className="text-fg-3">
              ›
            </span>
            <span className="font-semibold text-fg" aria-current="true">
              {enteredName}
            </span>
            <button type="button" className={buttonClass('secondary')} onClick={() => onScope(null)}>
              Back to the flow (Esc)
            </button>
          </>
        )}
      </nav>
      <details open className={cx(floatClass, 'top-3 right-3 z-30 max-h-[70%] w-[220px] overflow-auto px-2.5 py-2 max-md:w-[180px]')}>
        <summary className={cx(kickerClass, 'flex min-h-6 cursor-pointer items-center')}>Services ({boards.length}) · or click a plane</summary>
        <section aria-label="Services in this flow">
          <ul className="m-0 mt-1 flex list-none flex-col gap-0.5 p-0 text-sm">
            {boards.map((b) => (
              <li key={b.serviceDefinitionId}>
                <button type="button" className="min-h-6 w-full rounded-sm px-1.5 py-0.5 text-left text-fg hover:bg-surface-3 aria-pressed:bg-accent-soft" aria-pressed={entered === b.serviceDefinitionId} onClick={() => onScope(b.serviceDefinitionId)}>
                  Enter {b.name}
                  {!b.hasBoard && <span className="text-xs text-fg-3"> · no board yet</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      </details>
      <p className={cx(floatClass, 'bottom-3 left-3 z-30 m-0 px-2.5 py-1 text-xs text-fg-2')}>
        Drag to orbit · right-drag to pan · scroll to zoom · click a step to select it ·{' '}
        <button type="button" className="underline" onClick={onExit}>
          Back to the swimlane
        </button>
      </p>
    </>
  );
}

function Fallback({ title, body, onExit, onRetry }: { title: string; body: string; onExit: () => void; onRetry?: () => void }) {
  return (
    <div className="grid h-[420px] place-items-center p-4" role="alert">
      <div className="max-w-[440px] rounded-xl border border-line bg-float px-6.5 py-5.5 text-center text-fg-2 shadow-float">
        <h2 className="m-0 mb-1.5 text-lg font-semibold text-fg">{title}</h2>
        <p className="m-0 mb-3.5">{body}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <button type="button" className={buttonClass('primary')} onClick={onExit}>
            Show the swimlane
          </button>
          {onRetry && (
            <button type="button" className={buttonClass('secondary')} onClick={onRetry}>
              Try 3D again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

class DrilldownErrorBoundary extends Component<{ children: ReactNode; onExit: () => void }, { error: string | null }> {
  override state = { error: null as string | null };
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  override render() {
    if (this.state.error) return <Fallback title="The 3D view stopped" body={`The swimlane and the boards are unaffected. (${this.state.error})`} onExit={this.props.onExit} onRetry={() => this.setState({ error: null })} />;
    return this.props.children;
  }
}
