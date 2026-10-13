import { Link, useLocation } from 'react-router';
import { dependenciesOf, type BoardIndex } from '../../transit/board';
import type { DependencyLink } from '../../transit/links';
import type { Line } from '../../transit/types';
import { StatusShape } from '../../shared/ui/StatusShape';
import { linkSummary } from './linkText';

/**
 * The dependencies a line reaches, as the topology knows them (ADR-027): health, kind, and a link
 * that selects the entity on the map. Dependencies the topology lacks say so.
 */
export function DependencyList({ index, line, links }: { index: BoardIndex; line: Line; links: ReadonlyMap<string, DependencyLink> }) {
  const { search } = useLocation();
  const shared = new URLSearchParams(search);
  for (const name of ['line', 'mode', 'trace', 't', 'flow', 'window']) shared.delete(name);
  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
      {dependenciesOf(index, line).map((station) => {
        const link = links.get(station.id);
        const to = new URLSearchParams(shared);
        if (link?.status === 'linked') to.set('sel', `${link.ref.kind}:${link.ref.id}`);
        return (
          <li key={station.id} data-dependency={station.id} data-link={link?.status ?? 'none'} className="flex flex-col">
            <span className="flex items-center gap-2">
              {link?.status === 'linked' && link.health && <StatusShape health={link.health} />}
              {link?.status === 'linked' ? (
                <Link to={{ pathname: '/map', search: `?${to.toString()}` }} className="text-accent-fg underline">
                  {station.name}
                </Link>
              ) : (
                <span className="text-fg">{station.name}</span>
              )}
              {station.sub && <span className="font-mono text-xs text-fg-3">{station.sub}</span>}
            </span>
            {link && <span className="text-xs text-fg-3">{linkSummary(link)}</span>}
          </li>
        );
      })}
    </ul>
  );
}
