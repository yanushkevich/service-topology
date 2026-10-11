import { isRouteErrorResponse, Link, useRouteError } from 'react-router';

/** Last-resort boundary for errors thrown while rendering a route. */
export function RouteError() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'Unknown error';

  return (
    <div className="mx-auto my-[15vh] max-w-[560px] px-4 text-fg [&_p]:text-crit-fg" role="alert">
      <h1>Something went wrong</h1>
      <p className="font-mono">{message}</p>
      <Link to="/map">Return to the Service Map</Link>
    </div>
  );
}
