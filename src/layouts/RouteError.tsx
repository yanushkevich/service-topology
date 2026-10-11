import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import styles from './shell.module.css';

/** Last-resort boundary for errors thrown while rendering a route. */
export function RouteError() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'Unknown error';

  return (
    <div className={styles.fatal} role="alert">
      <h1>Something went wrong</h1>
      <p className="mono">{message}</p>
      <Link to="/map">Return to the Service Map</Link>
    </div>
  );
}
