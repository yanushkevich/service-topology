import { useId } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useTopology } from '../data/topologyContext';
import { useUiStore } from '../state/uiStore';
import { Icon } from '../shared/ui/Icon';
import styles from './shell.module.css';

export function Header() {
  const theme = useUiStore((s) => s.theme);
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const environmentId = useUiStore((s) => s.environmentId);
  const setEnvironmentId = useUiStore((s) => s.setEnvironmentId);
  const query = useUiStore((s) => s.filters.query);
  const setFilters = useUiStore((s) => s.setFilters);
  const topology = useTopology();
  const navigate = useNavigate();
  const location = useLocation();
  const environments = topology.status === 'ready' ? topology.index.data.environments : [];
  const envSelectId = useId();
  const searchId = useId();
  const nextTheme = theme === 'dark' ? 'light' : 'dark';

  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" strokeWidth="1.5" aria-hidden="true">
          <ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(-28 12 12)" stroke="var(--color-ice)" />
          <ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(42 12 12)" stroke="var(--color-indigo)" />
          <circle cx="12" cy="12" r="2.2" fill="var(--color-accent)" stroke="var(--color-accent)" />
        </svg>
        <span className={styles.brandName}>Orrery</span>
      </div>
      <div className={`${styles.divider} ${styles.hideSmall}`} aria-hidden="true" />

      <div className={styles.headerControl}>
        <label htmlFor={envSelectId} className="visually-hidden">
          Environment
        </label>
        <span className={styles.envSwatch} aria-hidden="true" />
        <select
          id={envSelectId}
          className={`${styles.envSelect} mono`}
          value={environmentId}
          onChange={(e) => setEnvironmentId(e.target.value)}
          disabled={environments.length === 0}
        >
          {environments.length === 0 && <option value={environmentId}>{environmentId}</option>}
          {environments.map((env) => (
            <option key={env.id} value={env.id}>
              {env.id}
            </option>
          ))}
        </select>
        <Icon name="chevronDown" className={styles.selectChevron} />
      </div>

      <div className={`${styles.headerControl} ${styles.search}`}>
        <Icon name="search" />
        <label htmlFor={searchId} className="visually-hidden">
          Search services and resources
        </label>
        <input
          id={searchId}
          className={styles.searchInput}
          type="search"
          placeholder="Search services, resources, owners…"
          value={query}
          onChange={(e) => {
            setFilters({ query: e.target.value });
            // Search results are shown in the registry until the map supports search/focus (Milestone 2).
            if (location.pathname !== '/registry') navigate('/registry');
          }}
        />
      </div>

      <div className={styles.headerEnd}>
        <button
          type="button"
          className={styles.iconButton}
          onClick={toggleTheme}
          aria-label={`Switch to ${nextTheme} theme`}
          title={`Switch to ${nextTheme} theme`}
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
        </button>
        <button type="button" className={styles.avatar} aria-label="Account menu (placeholder)" disabled>
          <span aria-hidden="true">—</span>
        </button>
      </div>
    </header>
  );
}
