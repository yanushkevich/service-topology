import { displayName, kindOfId } from '../../domain/topologyIndex';
import { KIND_LABELS } from './entityForms';
import type { FormContext } from './entityForms';
import type { DisplayIssue } from './issueMessages';

/** Validation issues, naming the entity each one is about. */
export function IssueList({ issues, title, ctx }: { issues: readonly DisplayIssue[]; title: string; ctx: FormContext }) {
  if (issues.length === 0) return null;
  return (
    <div role="alert" className="rounded-lg border border-crit px-3 py-2 text-sm">
      <p className="m-0 mb-1 font-medium text-crit-fg">{title}</p>
      <ul className="m-0 flex list-disc flex-col gap-1 pl-4.5 text-fg-2">
        {issues.map((issue, i) => (
          <li key={`${issue.code}-${issue.entityId ?? ''}-${i}`}>
            {issue.entityId && (
              <>
                <b className="text-fg">{displayName(ctx.index, issue.entityId)}</b>
                <span className="text-fg-3"> ({kindLabel(ctx, issue.entityId)})</span>:{' '}
              </>
            )}
            {issue.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function kindLabel(ctx: FormContext, id: string): string {
  const kind = kindOfId(ctx.index, id) ?? (ctx.index.eventTypes.has(id) ? 'event-type' : undefined);
  return kind ? KIND_LABELS[kind].toLowerCase() : 'entity';
}
