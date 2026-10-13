import type { DependencyLink } from '../../transit/links';
import { healthLabel, typeLabel } from '../../shared/mappings';

/** One line about a dependency's topology link: "In the topology: database · Healthy". */
export function linkSummary(link: DependencyLink): string {
  switch (link.status) {
    case 'linked':
      return `In the topology: ${link.kind === 'service' ? 'service' : typeLabel(link.type).toLowerCase()} · ${link.health ? healthLabel(link.health) : 'health not modelled'}`;
    case 'not-in-environment':
      return 'In the topology, but not in this environment';
    case 'not-in-topology':
      return 'Not in the topology: health and impact cannot be shown';
  }
}
