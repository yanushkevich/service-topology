import { useId, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { useTopology } from '../../data/topologyContext';
import { eventFlowsIn, resolveEventFlow, type EventFlow, type EventFlowParticipant } from '../../domain/eventFlow';
import type { TopologyIndex } from '../../domain/topologyIndex';
import type { EntityRef } from '../../domain/types';
import { typeLabel } from '../../shared/mappings';
import { buttonClass, cx, fieldClass, kickerClass } from '../../shared/ui/classes';
import { EntityEditActions } from '../editing/EditingControls';
import { useEntityEditing } from '../editing/editingContext';
import { DataSourceTag } from '../../shared/ui/DataSourceTag';
import { LoadState } from '../../shared/ui/LoadState';
import { StatusShape } from '../../shared/ui/StatusShape';
import { TypeGlyph } from '../../shared/ui/TypeGlyph';
import { useUiStore } from '../../state/uiStore';
import { InspectorPanel } from '../inspector/InspectorPanel';
import { Note } from '../pages/PageShell';

/**
 * Event catalog (PRODUCT_SPEC Revision 6 §M.2, UI mock "Events"): event types carried on topics,
 * queues, and exchanges in the selected environment, with producers → channel → consumers.
 */
export function EventsPage() {
  const topology = useTopology();
  return (
    <div className="absolute inset-0 flex max-md:flex-col">
      {topology.status === 'ready' ? (
        <Catalog index={topology.index} sourceLabel={topology.sourceLabel} isMock={topology.isMock} />
      ) : (
        <div className="flex-1 p-5">
          <h1 className="m-0 mb-3 text-xl font-semibold">Events</h1>
          <LoadState state={topology} />
        </div>
      )}
      <InspectorPanel />
    </div>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function Catalog({ index, sourceLabel, isMock }: { index: TopologyIndex; sourceLabel: string; isMock: boolean }) {
  const environmentId = useUiStore((s) => s.environmentId);
  const environmentName = index.environments.get(environmentId)?.name ?? environmentId;
  const { eventTypeId } = useParams();
  const { search } = useLocation();
  const [query, setQuery] = useState('');
  const inputId = useId();

  const flows = useMemo(() => eventFlowsIn(index, environmentId), [index, environmentId]);
  const q = query.trim().toLowerCase();
  const listed = q ? flows.filter((f) => `${f.eventType.name} ${index.resources.get(f.channelId)?.name ?? ''}`.toLowerCase().includes(q)) : flows;

  // The route names the event; without one, the first event in the environment is shown (as in the mock).
  const requested = eventTypeId ? index.eventTypes.get(eventTypeId) : undefined;
  const selectedFlow = eventTypeId ? (requested ? resolveEventFlow(index, requested, environmentId) : null) : (flows[0] ?? null);

  return (
    <div className="flex min-w-0 flex-1 flex-wrap content-start overflow-auto">
      <div className="flex max-w-[420px] min-w-0 flex-[1_1_300px] flex-col gap-2.5 py-5 pr-3.5 pl-5 max-md:max-w-none max-md:px-3">
        <div className="flex flex-wrap items-baseline gap-2.5">
          <h1 className="m-0 text-xl font-semibold">Events</h1>
          <span className="font-mono text-[11.5px] text-fg-3">
            {plural(listed.length, 'event')} · {environmentName}
          </span>
          <NewEventTypeButton />
        </div>
        <div>
          <DataSourceTag sourceLabel={sourceLabel} isMock={isMock} />
        </div>
        <label htmlFor={inputId} className="sr-only">
          Search events
        </label>
        <input
          id={inputId}
          type="search"
          className={fieldClass}
          placeholder="Search events or topics, e.g. Payment"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {flows.length === 0 ? (
          <Note>No event types are modeled for {environmentName}.</Note>
        ) : listed.length === 0 ? (
          <Note>No events match “{query}”. Try part of an event name or the topic it travels on.</Note>
        ) : (
          <ul aria-label="Event types" className="m-0 flex list-none flex-col gap-0.5 p-0">
            {listed.map((flow) => {
              const current = flow.eventType.id === selectedFlow?.eventType.id;
              return (
                <li key={flow.eventType.id}>
                  <Link
                    to={{
                      pathname: `/events/${encodeURIComponent(flow.eventType.id)}`,
                      search,
                    }}
                    aria-current={current ? 'page' : undefined}
                    className="group block rounded-lg px-2.5 py-1.5 hover:bg-surface-3 aria-[current=page]:bg-accent-soft aria-[current=page]:shadow-[inset_0_0_0_1px_var(--color-accent-ring)]"
                  >
                    <span className="block font-mono text-[13px] font-medium text-fg">{flow.eventType.name}</span>
                    <span className="block text-[11.5px] text-fg-3 group-aria-[current=page]:text-fg-2">
                      <span className="font-mono">{index.resources.get(flow.channelId)?.name}</span> · {plural(flow.producers.length, 'producer')} ·{' '}
                      {plural(flow.consumers.length, 'consumer')}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="min-h-full min-w-0 flex-[999_1_520px] border-l border-line px-6 py-[22px] max-md:border-t max-md:border-l-0 max-md:px-3">
        {selectedFlow ? (
          <EventDetail index={index} flow={selectedFlow} environmentName={environmentName} />
        ) : eventTypeId && requested ? (
          <>
            <Note>
              {requested.name} is not carried in {environmentName}. Choose another environment or event
              {requested.channelResourceIds.length === 0 ? ', or edit it to add the topic, queue, or exchange that carries it' : ''}.
            </Note>
            <div className="mt-3">
              <EntityEditActions kind="event-type" id={requested.id} label={requested.name} />
            </div>
          </>
        ) : eventTypeId ? (
          <Note>No event type with ID “{eventTypeId}” exists in this data.</Note>
        ) : (
          <Note>Select an event to see who publishes and consumes it.</Note>
        )}
      </div>
    </div>
  );
}

function EventDetail({ index, flow, environmentName }: { index: TopologyIndex; flow: EventFlow; environmentName: string }) {
  const navigate = useNavigate();
  const { search } = useLocation();
  const { eventType } = flow;
  const channel = index.resources.get(flow.channelId);
  const headingId = useId();
  const select = (ref: EntityRef) => useUiStore.getState().select(ref);
  const openMap = (view: '2d' | '3d') => {
    const ui = useUiStore.getState();
    ui.select(null);
    ui.setNeighborhood(null);
    ui.setEventHighlight(eventType.id);
    if (view === '3d') ui.exitScopeTo(0);
    ui.setActiveView(view);
    navigate({ pathname: '/map', search });
  };
  if (!channel) return null; // resolveEventFlow only returns flows on existing channels
  const verb = channel.type === 'queue' ? 'enqueues' : 'publishes';
  const owner = [eventType.owner, eventType.team].filter(Boolean).join(' / ');

  return (
    <section aria-labelledby={headingId}>
      <div className={kickerClass}>Event</div>
      <h2 id={headingId} className="m-0 mt-0.5 mb-1.5 font-mono text-[22px] font-medium break-words">
        {eventType.name}
      </h2>
      {eventType.description && <p className="m-0 max-w-[620px] text-fg-2">{eventType.description}</p>}
      <div className="mt-3.5 mb-[22px] flex flex-wrap items-center gap-2">
        <button type="button" className={buttonClass('primary')} onClick={() => openMap('2d')}>
          Highlight in 2D
        </button>
        <button type="button" className={buttonClass('secondary')} onClick={() => openMap('3d')}>
          Show in 3D galaxy
        </button>
        {eventType.schemaVersion && (
          <span className="rounded-md border border-line bg-surface-2 px-2 py-1 font-mono text-xs text-fg-2">schema {eventType.schemaVersion}</span>
        )}
        {owner && <span className="rounded-md border border-line bg-surface-2 px-2 py-1 text-xs text-fg-2">Owner · {owner}</span>}
        <span className="ml-auto">
          <EntityEditActions kind="event-type" id={eventType.id} label={eventType.name} />
        </span>
      </div>

      {/* Horizontal producers → event → consumers when there is room (as in the mock), stacked otherwise. */}
      <div className="@container">
        <div className="flex flex-col gap-3 @4xl:grid @4xl:grid-cols-[minmax(0,1fr)_60px_minmax(0,230px)_60px_minmax(0,1fr)] @4xl:items-center">
          <ParticipantColumn
            index={index}
            title="Producers"
            role={verb}
            participants={flow.producers}
            environmentName={environmentName}
            empty="No producers are modeled for this event."
            onSelect={select}
          />
          <FlowArrow />
          <button
            type="button"
            onClick={() => select({ kind: 'resource', id: channel.id })}
            className="w-full max-w-[300px] self-center rounded-xl border border-accent bg-surface-1 p-4 text-center hover:bg-surface-2"
          >
            <span className="flex justify-center">
              <TypeGlyph type={channel.type} size={26} />
            </span>
            <span className="mt-2 block font-mono font-medium">{eventType.name}</span>{' '}
            <span className="block text-[11.5px] text-fg-3">
              carried on <span className="font-mono">{channel.name}</span> <span className="sr-only">({typeLabel(channel.type)}). Select the channel.</span>
            </span>{' '}
            <span className="mt-1.5 flex justify-center">
              <StatusShape health={channel.health ?? 'unknown'} label />
            </span>
          </button>
          <FlowArrow />
          <ParticipantColumn
            index={index}
            title="Consumers"
            role="consumes"
            participants={flow.consumers}
            environmentName={environmentName}
            empty="No consumers are modeled for this event."
            onSelect={select}
          />
        </div>
      </div>
    </section>
  );
}

function FlowArrow() {
  return (
    <svg viewBox="0 0 60 14" className="my-3 h-3.5 w-[60px] flex-none rotate-90 self-center overflow-visible @4xl:my-0 @4xl:rotate-0" aria-hidden="true">
      <path d="M2 7H46" stroke="var(--edge-event)" strokeWidth="2" strokeDasharray="9 4 2 4" fill="none" />
      <path d="M58 7l-9 -3.6v7.2z" fill="var(--edge-event)" />
    </svg>
  );
}

function ParticipantColumn({
  index,
  title,
  role,
  participants,
  environmentName,
  empty,
  onSelect,
}: {
  index: TopologyIndex;
  title: string;
  role: string;
  participants: EventFlowParticipant[];
  environmentName: string;
  empty: string;
  onSelect: (ref: EntityRef) => void;
}) {
  const selection = useUiStore((s) => s.selection);
  const listId = useId();
  return (
    <div className="min-w-0">
      <h3 id={listId} className={cx('m-0 mb-1.5 flex items-center justify-between gap-2 font-normal', kickerClass)}>
        <span>{title}</span>
        <span>{participants.length}</span>
      </h3>
      {participants.length === 0 ? (
        <Note>{empty}</Note>
      ) : (
        <ul aria-labelledby={listId} className="m-0 flex list-none flex-col gap-2 p-0">
          {participants.map((p) => {
            const definition = index.definitions.get(p.serviceDefinitionId);
            const name = definition?.name ?? p.serviceDefinitionId;
            const instance = p.instanceId ? index.instances.get(p.instanceId) : undefined;
            if (!instance) {
              return (
                <li
                  key={p.serviceDefinitionId}
                  className="flex min-h-12 items-center gap-2.5 rounded-xl border border-dashed border-line-strong px-3 text-sm text-fg-2"
                >
                  <TypeGlyph type={definition?.category ?? 'other'} size={18} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-fg">{name}</span>
                    <span className="block text-xs">Not deployed in {environmentName}</span>
                  </span>
                </li>
              );
            }
            const via = p.viaQueueId ? index.resources.get(p.viaQueueId)?.name : undefined;
            return (
              <li key={p.serviceDefinitionId}>
                <button
                  type="button"
                  aria-pressed={selection?.id === instance.id}
                  onClick={() => onSelect({ kind: 'service-instance', id: instance.id })}
                  className="flex min-h-12 w-full items-center gap-2.5 rounded-xl border border-line bg-surface-1 px-3 text-left hover:bg-surface-2 aria-pressed:border-accent aria-pressed:bg-accent-soft"
                >
                  <TypeGlyph type={definition?.category ?? 'other'} size={18} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{name}</span>
                    {via && (
                      <span className="block text-xs text-fg-3">
                        via queue <span className="font-mono">{via}</span>
                      </span>
                    )}
                  </span>
                  <span className="font-mono text-xs text-fg-3">{role}</span>
                  <StatusShape health={instance.health} label />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Shortcut to create an event type; the header's New menu explains when editing is unavailable. */
function NewEventTypeButton() {
  const { unavailable, openCreate } = useEntityEditing();
  if (unavailable) return null;
  return (
    <button type="button" className={buttonClass('secondary', 'ml-auto h-7 text-sm')} onClick={() => openCreate('event-type')}>
      New event type
    </button>
  );
}
