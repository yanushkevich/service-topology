import type { ReactNode } from 'react';
import { endpointName, kindOfId, resourceAncestors, type TopologyIndex } from '../../domain/topologyIndex';
import { DYNATRACE_LINK_KEY, sourceLinkOf, type SourceLink } from '../../domain/sourceLink';
import type { CommunicationRelationship, EntityId, EntityRef, HealthStatus, Metrics } from '../../domain/types';
import { formatMetadataValue, formatNumber, formatTimestamp } from '../../shared/format';
import { healthLabel, protocolLabel, relationshipStatusHealth, typeLabel } from '../../shared/mappings';
import { Icon } from '../../shared/ui/Icon';
import { SimulatedTag } from '../../shared/ui/DataSourceTag';
import { StatusShape } from '../../shared/ui/StatusShape';
import { TypeGlyph } from '../../shared/ui/TypeGlyph';
import { useUiStore } from '../../state/uiStore';

/** Building blocks of the inspector: header, fields, sections, entity links, metrics, metadata. */
export function MissingSelection({ selection }: { selection: EntityRef }) {
  const select = useUiStore((s) => s.select);
  return (
    <div className="m-auto px-6.5 py-5.5 text-center" role="status">
      <h2 className="m-0 mb-1.5 text-lg font-semibold">Selection not found</h2>
      <p className="m-0 mb-3 text-fg-2">
        No {selection.kind.replace('-', ' ')} with ID <span className="font-mono">{selection.id}</span> exists in the
        current data.
      </p>
      <button type="button" className="inline-flex h-7 items-center gap-[7px] rounded-md border border-line-strong px-3 whitespace-nowrap text-fg hover:bg-surface-3" onClick={() => select(null)}>
        Clear selection
      </button>
    </div>
  );
}

export function Header({
  glyph,
  name,
  subtitle,
  health,
  healthText,
  note,
}: {
  glyph: string;
  name: string;
  subtitle: string;
  health?: HealthStatus | undefined;
  healthText?: string;
  note?: string | undefined;
}) {
  const select = useUiStore((s) => s.select);
  return (
    <div className="flex-none border-b border-line px-3.5 pt-3.5 pb-3">
      <div className="flex items-start gap-[11px]">
        <span className="grid size-[38px] flex-none place-items-center rounded-lg border border-line bg-surface-3">
          <TypeGlyph type={glyph} size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="m-0 truncate text-lg font-semibold">{name}</h2>
          <div className={`font-mono truncate text-xs text-fg-3`}>{subtitle}</div>
        </div>
        <button type="button" className="grid size-7.5 flex-none place-items-center rounded-md text-fg-2 hover:bg-surface-3 hover:text-fg" onClick={() => select(null)} aria-label="Close inspector">
          <Icon name="close" />
        </button>
      </div>
      {health && (
        <div className="mt-3 flex items-center gap-2 rounded-[9px] bg-surface-3 px-2.5 py-2 text-[12.5px]">
          <StatusShape health={health} />
          <b>{healthText ?? healthLabel(health)}</b>
          {note && <span className="min-w-0 truncate text-sm text-fg-2">{note}</span>}
        </div>
      )}
    </div>
  );
}

export function Body({ children }: { children: ReactNode }) {
  return <div className="min-h-0 flex-1 overflow-auto px-3.5 pt-3 pb-4">{children}</div>;
}

export function Fields({ children }: { children: ReactNode }) {
  return <dl className="m-0 grid grid-cols-2 gap-2">{children}</dl>;
}

export function Field({ label, mono, children }: { label: string; mono?: boolean; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-surface-3/60 px-[11px] py-[9px]">
      <dt className="text-[10px] tracking-[0.07em] text-fg-3 uppercase">{label}</dt>
      <dd className={`m-0 mt-0.5 text-[12.5px] wrap-anywhere ${mono ? 'font-mono' : ''}`}>{children}</dd>
    </div>
  );
}

export function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="mt-4">
      <h3 className="m-0 mb-1.5 flex items-center justify-between gap-2 text-[10px] font-normal tracking-[0.08em] text-fg-3 uppercase">
        <span>{title}</span>
        {count !== undefined && <span>{count}</span>}
      </h3>
      {children}
    </section>
  );
}

export function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-line py-1.5 text-sm">
      <span className="text-fg-3">{label}</span>
      <span className={`font-mono min-w-0 text-right wrap-anywhere`}>{value}</span>
    </div>
  );
}

export function EntityButton({ target, children }: { target: EntityRef; children: ReactNode }) {
  const select = useUiStore((s) => s.select);
  return (
    <button type="button" className="flex min-h-[34px] w-full items-center gap-[9px] rounded-md px-2 text-left enabled:hover:bg-surface-3" onClick={() => select(target)}>
      {children}
    </button>
  );
}

export function ContainmentPath({
  index,
  resourceId,
  includeSelf = false,
}: {
  index: TopologyIndex;
  resourceId: EntityId;
  includeSelf?: boolean;
}) {
  const self = index.resources.get(resourceId);
  const chain = [...resourceAncestors(index, resourceId), ...(includeSelf && self ? [self] : [])];
  return (
    <ol className="m-0 list-none p-0 [&>li+li]:ml-3 [&>li+li]:border-l [&>li+li]:border-line-strong [&>li+li]:pl-1" aria-label="Containment path">
      {chain.map((resource) => (
        <li key={resource.id}>
          <EntityButton target={{ kind: 'resource', id: resource.id }}>
            <span className="min-w-0 flex-1 truncate text-[12.5px]">{resource.name}</span>
            <span className={`font-mono text-[10px] whitespace-nowrap text-fg-3`}>{typeLabel(resource.type)}</span>
          </EntityButton>
        </li>
      ))}
    </ol>
  );
}

export function Relationships({ index, entityId }: { index: TopologyIndex; entityId: EntityId }) {
  const outgoing = index.outgoing.get(entityId) ?? [];
  const incoming = index.incoming.get(entityId) ?? [];
  return (
    <>
      <Section title="Outgoing (calls, publishes to)" count={outgoing.length}>
        {outgoing.length === 0 && <p className="m-0 px-2 py-1 text-sm text-fg-3">No outgoing connections modeled.</p>}
        {outgoing.map((r) => (
          <RelationshipRow key={r.id} index={index} relationship={r} peerId={r.targetEntityId} />
        ))}
      </Section>
      <Section title="Incoming (called by, delivers to)" count={incoming.length}>
        {incoming.length === 0 && <p className="m-0 px-2 py-1 text-sm text-fg-3">No incoming connections modeled.</p>}
        {incoming.map((r) => (
          <RelationshipRow key={r.id} index={index} relationship={r} peerId={r.sourceEntityId} />
        ))}
      </Section>
    </>
  );
}

function RelationshipRow({
  index,
  relationship,
  peerId,
}: {
  index: TopologyIndex;
  relationship: CommunicationRelationship;
  peerId: EntityId;
}) {
  const select = useUiStore((s) => s.select);
  const peerKind = kindOfId(index, peerId);
  const peerName = endpointName(index, peerId);
  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        className="flex min-h-[34px] w-full items-center gap-[9px] rounded-md px-2 text-left enabled:hover:bg-surface-3"
        onClick={() => peerKind && select({ kind: peerKind, id: peerId })}
        disabled={!peerKind}
      >
        <span className="min-w-0 flex-1 truncate text-[12.5px]">{peerName}</span>
        <span className={`font-mono text-[10px] whitespace-nowrap text-fg-3`}>{protocolLabel(relationship.protocol)}</span>
        <StatusShape health={relationshipStatusHealth(relationship.status)} />
      </button>
      <button
        type="button"
        className="grid size-7 flex-none place-items-center rounded-sm text-fg-3 hover:bg-surface-3 hover:text-fg"
        onClick={() => select({ kind: 'relationship', id: relationship.id })}
        aria-label={`Connection details: ${protocolLabel(relationship.protocol)} with ${peerName}`}
        title="Connection details"
      >
        <Icon name="chevronRight" />
      </button>
    </div>
  );
}

export function MetricsSection({ metrics }: { metrics: Metrics | undefined }) {
  return (
    <section className="mt-4" aria-label="Telemetry">
      <h3 className="m-0 mb-1.5 flex items-center justify-between gap-2 text-[10px] font-normal tracking-[0.08em] text-fg-3 uppercase">
        <span>Telemetry</span>
        {metrics && <SimulatedTag simulated={metrics.isSimulated} />}
      </h3>
      {metrics ? (
        <>
          <dl className="m-0 mb-1.5 grid grid-cols-3 gap-2">
            <div className="min-w-0 rounded-lg border border-line bg-surface-3/60 px-[11px] py-[9px]">
              <dt className="text-[10px] tracking-[0.07em] text-fg-3 uppercase">Latency</dt>
              <dd className={`m-0 mt-0.5 text-lg font-medium font-mono`}>{formatNumber(metrics.latencyMs, ' ms')}</dd>
            </div>
            <div className="min-w-0 rounded-lg border border-line bg-surface-3/60 px-[11px] py-[9px]">
              <dt className="text-[10px] tracking-[0.07em] text-fg-3 uppercase">Throughput</dt>
              <dd className={`m-0 mt-0.5 text-lg font-medium font-mono`}>{formatNumber(metrics.throughputPerSecond, '/s')}</dd>
            </div>
            <div className="min-w-0 rounded-lg border border-line bg-surface-3/60 px-[11px] py-[9px]">
              <dt className="text-[10px] tracking-[0.07em] text-fg-3 uppercase">Errors</dt>
              <dd className={`m-0 mt-0.5 text-lg font-medium font-mono`}>{formatNumber(metrics.errorRatePercent, '%')}</dd>
            </div>
          </dl>
          <p className="m-0 px-2 py-1 text-sm text-fg-3">
            {metrics.isSimulated ? 'Simulated values, not observed telemetry' : 'Observed'} · as of{' '}
            {formatTimestamp(metrics.observedAt)}
          </p>
        </>
      ) : (
        <p className="m-0 px-2 py-1 text-sm text-fg-3">No telemetry available.</p>
      )}
    </section>
  );
}

/**
 * Where an entity's data comes from in Dynatrace (ADR-034): its Smartscape ID, when its health was
 * observed and the open Davis problems, or that Dynatrace no longer sees it but it is kept because
 * something here uses it. Nothing for entities without a link.
 */
export function SourceLinkSection({ metadata, observable }: { metadata: Record<string, unknown> | undefined; observable: boolean }) {
  const link = sourceLinkOf(metadata);
  if (!link) return null;
  return (
    <Section title="Dynatrace">
      {link.id && <KeyValue label="Entity" value={link.id} />}
      {link.name && <KeyValue label="Service name" value={link.name} />}
      {link.messaging && <KeyValue label="Messaging" value={`${link.messaging.system} · ${link.messaging.destination}`} />}
      {link.missingSince && (
        <p className="m-0 px-2 py-1 text-sm text-warn-fg">Not seen in Dynatrace since {formatTimestamp(link.missingSince)}. Kept because something here still uses it.</p>
      )}
      {/* Topics and queues come from metrics, not Smartscape nodes: they have no observed health. */}
      {observable && link.id && !link.missingSince && <ObservedLine link={link} />}
    </Section>
  );
}

function ObservedLine({ link }: { link: SourceLink }) {
  if (!link.observedAt) return <p className="m-0 px-2 py-1 text-sm text-fg-3">Health not observed yet, or the last observation is out of date.</p>;
  return (
    <p className="m-0 px-2 py-1 text-sm text-fg-2">
      Health observed at {formatTimestamp(link.observedAt)} ·{' '}
      {link.problems.length > 0 ? <span className="text-warn-fg">open problems: {link.problems.join(', ')}</span> : 'no open problems'}
    </p>
  );
}

export function Metadata({ metadata }: { metadata: Record<string, unknown> | undefined }) {
  // The Dynatrace link has its own section (SourceLinkSection).
  const entries = Object.entries(metadata ?? {}).filter(([key]) => key !== 'note' && key !== DYNATRACE_LINK_KEY);
  if (entries.length === 0) return null;
  return (
    <Section title="Metadata">
      {entries.map(([key, value]) => (
        <KeyValue key={key} label={key} value={formatMetadataValue(value)} />
      ))}
    </Section>
  );
}
