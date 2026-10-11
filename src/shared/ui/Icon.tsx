import type { ReactNode } from 'react';

/** 16×16 stroke glyphs from docs/ui-frontend-mock/Main.dc.html. Decorative: always pair with text or an aria-label. */
const PATHS = {
  overview: <path d="M2.5 2.5h4.5v4.5h-4.5zM9 2.5h4.5v4.5H9zM2.5 9h4.5v4.5h-4.5zM9 9h4.5v4.5H9z" />,
  map: (
    <>
      <circle cx="3.5" cy="8" r="1.8" />
      <circle cx="12.5" cy="3.5" r="1.8" />
      <circle cx="12.5" cy="12.5" r="1.8" />
      <path d="M5.2 7.2l5.6-3M5.2 8.8l5.6 3" />
    </>
  ),
  registry: <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />,
  infrastructure: (
    <>
      <rect x="2.5" y="2.5" width="11" height="4" rx="1" />
      <rect x="2.5" y="9.5" width="11" height="4" rx="1" />
    </>
  ),
  dependencies: <path d="M3 3v6a3 3 0 003 3h7M10.5 9.5L13 12l-2.5 2.5" />,
  events: <path d="M9 1.5L3.5 9H8l-1 5.5L12.5 7H8z" />,
  settings: (
    <>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
    </>
  ),
  search: (
    <>
      <circle cx="7" cy="7" r="4.2" />
      <path d="M10.2 10.2L13.5 13.5" />
    </>
  ),
  sun: (
    <>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M3.4 12.6l1.3-1.3M11.3 4.7l1.3-1.3" />
    </>
  ),
  moon: <path d="M13 9.5A5.5 5.5 0 016.5 3a5.5 5.5 0 106.5 6.5z" />,
  view2d: (
    <>
      <circle cx="3.5" cy="8" r="1.8" />
      <circle cx="12.5" cy="8" r="1.8" />
      <path d="M5.3 8h5.4" />
    </>
  ),
  view3d: (
    <>
      <ellipse cx="8" cy="8" rx="6" ry="2.6" />
      <circle cx="8" cy="8" r="1.4" />
    </>
  ),
  chevronDown: <path d="M4 6l4 4 4-4" />,
  chevronRight: <path d="M6 4l4 4-4 4" />,
  close: <path d="M4 4l8 8M12 4l-8 8" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className }: { name: IconName; className?: string | undefined }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flex: 'none' }}
    >
      {PATHS[name]}
    </svg>
  );
}
