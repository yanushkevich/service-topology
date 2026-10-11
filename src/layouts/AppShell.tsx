import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router';
import { NAV_ITEMS } from '../app/navigation';
import { TopologyDataProvider } from '../data/TopologyDataProvider';
import { useUiStore } from '../state/uiStore';
import { useUrlStateSync } from '../state/useUrlStateSync';
import { useSimulationTicker } from '../state/useSimulationTicker';
import { HistoryBanner } from './HistoryBanner';
import { Header } from './Header';
import { NavRail } from './NavRail';

export function AppShell() {
  const theme = useUiStore((s) => s.theme);
  useUrlStateSync();
  useSimulationTicker();
  useDocumentTitle();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <TopologyDataProvider>
    <div className="flex h-screen min-h-[640px] flex-col overflow-hidden bg-surface-0">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          // Move focus explicitly: not every browser/AT combination focuses an in-page link target.
          event.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        Skip to main content
      </a>
      <Header />
      <HistoryBanner />
      <div className="flex min-h-0 flex-1 max-md:flex-col">
        <NavRail />
        <main id="main-content" className="relative min-h-0 min-w-0 flex-1 overflow-auto focus:outline-none" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
    </TopologyDataProvider>
  );
}

/** Page title per section (WCAG 2.4.2), e.g. "Service Registry · Orrery". */
function useDocumentTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    const section = NAV_ITEMS.find((item) => pathname === item.path || pathname.startsWith(`${item.path}/`));
    document.title = `${section?.label ?? 'Page not found'} · Orrery`;
  }, [pathname]);
}

