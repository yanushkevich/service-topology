import { NavLink, useLocation } from 'react-router';
import { NAV_ITEMS } from '../app/navigation';
import { Icon } from '../shared/ui/Icon';

export function NavRail() {
  // Carry the view state (query string) across sections so selection and filters survive navigation.
  const { search } = useLocation();
  return (
    <nav className="flex w-[72px] flex-none flex-col items-center gap-1 border-r border-line bg-surface-1 py-2.5 max-md:w-auto max-md:flex-row max-md:justify-around max-md:overflow-x-auto max-md:border-r-0 max-md:border-b max-md:p-1" aria-label="Sections">
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.path}
          to={{ pathname: item.path, search }}
          className={({ isActive }) => `flex w-14 flex-col items-center gap-1 rounded-lg pt-[9px] pb-[7px] text-center text-2xs tracking-[0.02em] no-underline transition-colors max-md:w-12 ${isActive ? 'bg-accent-soft text-accent-fg shadow-[inset_0_0_0_1px_var(--color-accent-ring)]' : 'text-fg-3 hover:bg-surface-3 hover:text-fg'}`}
          // The accessible name contains the visible short label (WCAG 2.5.3 Label in Name).
          aria-label={item.shortLabel === item.label || item.label.includes(item.shortLabel + ' ') || item.label.endsWith(item.shortLabel) ? item.label : `${item.shortLabel} (${item.label})`}
          title={item.label}
        >
          <Icon name={item.icon} />
          <span aria-hidden="true">{item.shortLabel}</span>
        </NavLink>
      ))}
    </nav>
  );
}
