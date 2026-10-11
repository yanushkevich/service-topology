import { Navigate, useLocation } from 'react-router';

/** The root redirects to the Service Map, keeping any deep-link state. */
export function RedirectToMap() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: '/map', search }} replace />;
}
