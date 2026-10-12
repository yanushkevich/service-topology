import { ApiError, type ProblemIssue } from '../../data/http/apiClient';
import type { FieldErrors } from './entityForms';

/** A validation issue to show: local (validateTopology) or from the server's problem `errors[]`. */
export interface DisplayIssue {
  code: string;
  entityId?: string;
  message: string;
}

/**
 * Server `invalid-field` issues are "field: reason" (backend/internal/domain/fields.go); they go next
 * to the field. Everything else (whole-topology rules) is listed above the form.
 */
export function splitServerIssues(issues: readonly ProblemIssue[]): { fieldErrors: FieldErrors; other: DisplayIssue[] } {
  const fieldErrors: FieldErrors = {};
  const other: DisplayIssue[] = [];
  for (const issue of issues) {
    const match = issue.code === 'invalid-field' ? /^([A-Za-z]+): (.*)$/.exec(issue.message) : null;
    if (match?.[1] && match[2]) fieldErrors[match[1]] = match[2].charAt(0).toUpperCase() + match[2].slice(1);
    else other.push(issue);
  }
  return { fieldErrors, other };
}

/** A readable message for any failure: problem detail, title, and request ID for support. */
export function problemMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0 || error.status >= 500) return `The backend could not complete the request (${error.status} ${error.title}). Try again in a moment${error.requestId ? `; request ${error.requestId}` : ''}.`;
    if (error.status === 401 || error.status === 403) return 'You are not allowed to change the topology (an editor role is required).';
    return `${error.detail ?? error.title}${error.requestId ? ` (request ${error.requestId})` : ''}`;
  }
  return error instanceof Error ? `Could not reach the backend: ${error.message}` : 'Something went wrong.';
}

/** Why a delete is blocked, in plain words (validateTopology codes after removing the entity). */
const BLOCKER_REASONS: Record<string, string> = {
  'missing-relationship-endpoint': 'uses it as an endpoint',
  'missing-environment': 'belongs to this environment',
  'missing-service-definition': 'is a deployment of it',
  'missing-resource': 'runs in it',
  'missing-parent': 'is contained in it',
  'missing-event-channel': 'is carried on it',
  'missing-event-service': 'is produced or consumed by it',
  'event-flow-missing-relationship': 'needs this connection for its event flow',
};

export function asBlockers(issues: readonly DisplayIssue[]): DisplayIssue[] {
  const seen = new Set<string>();
  const out: DisplayIssue[] = [];
  for (const issue of issues) {
    const message = BLOCKER_REASONS[issue.code] ?? issue.message;
    const key = `${issue.entityId ?? ''}\u0000${message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...issue, message });
  }
  return out;
}
