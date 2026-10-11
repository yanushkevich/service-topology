import { useEffect } from 'react';
import { Outlet } from 'react-router';
import { TopologyDataProvider } from '../data/TopologyDataProvider';
import { useUiStore } from '../state/uiStore';
import { Header } from './Header';
import { NavRail } from './NavRail';
import styles from './shell.module.css';

export function AppShell() {
  const theme = useUiStore((s) => s.theme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <TopologyDataProvider>
    <div className={styles.app}>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <Header />
      <div className={styles.body}>
        <NavRail />
        <main id="main-content" className={styles.main} tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
    </TopologyDataProvider>
  );
}
