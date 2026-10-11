import { NavLink } from 'react-router';
import { NAV_ITEMS } from '../app/navigation';
import { Icon } from '../shared/ui/Icon';
import styles from './shell.module.css';

export function NavRail() {
  return (
    <nav className={styles.rail} aria-label="Sections">
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
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
