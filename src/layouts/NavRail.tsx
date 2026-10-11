import { NavLink, useLocation } from 'react-router';
import { NAV_ITEMS } from '../app/navigation';
import { Icon } from '../shared/ui/Icon';
import styles from './shell.module.css';

export function NavRail() {
  // Carry the view state (query string) across sections so selection and filters survive navigation.
  const { search } = useLocation();
  return (
    <nav className={styles.rail} aria-label="Sections">
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.path}
          to={{ pathname: item.path, search }}
          className={({ isActive }) => `${styles.navItem} ${isActive ? styles.navItemActive : ''}`}
          aria-label={item.label}
          title={item.label}
        >
          <Icon name={item.icon} />
          <span aria-hidden="true">{item.shortLabel}</span>
        </NavLink>
      ))}
    </nav>
  );
}
