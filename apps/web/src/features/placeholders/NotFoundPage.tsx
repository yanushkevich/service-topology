import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <div className="max-w-[620px] px-6.5 py-8">
      <p className="m-0 mb-2 font-mono text-xs tracking-[0.06em] text-fg-3 uppercase">404</p>
      <h1 className="m-0 mb-2 text-2xl font-semibold tracking-[-0.01em]">Page not found</h1>
      <p className="m-0 text-fg-2">
        This address does not match any section. <Link to="/map">Go to the Service Map</Link>.
      </p>
    </div>
  );
}
