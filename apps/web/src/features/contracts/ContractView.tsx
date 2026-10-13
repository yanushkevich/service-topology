import { useId, type ReactNode } from 'react';
import { schemaTypeName, type Contract, type ContractResponse, type SchemaNode } from '../../contracts/openapi';
import { cx } from '../../shared/ui/classes';
import { Kicker } from '../../shared/ui/primitives';
import type { EndpointContract } from './useEndpointContract';

/**
 * An endpoint's contract (ADR-029): the operation, its parameters, the request body, and each
 * response by status, as nested field lists with generated examples. Example specifications say so.
 */
export function ContractView({ state, compact }: { state: EndpointContract; compact?: boolean }) {
  switch (state.status) {
    case 'loading':
      return <p className="m-0 text-xs text-fg-3">Loading the contract…</p>;
    case 'error':
      return (
        <p role="alert" className="m-0 text-xs text-crit-fg">
          Could not load the contract: {state.message}
        </p>
      );
    case 'missing':
      return <p className="m-0 text-xs text-fg-3">No OpenAPI contract: {state.reason}</p>;
    case 'not-http':
      return <p className="m-0 text-xs text-fg-3">{state.kind}: only OpenAPI (HTTP) contracts are shown.</p>;
    case 'contract':
      return <Operation contract={state.contract} file={state.file} isExample={state.isExample} compact={compact} />;
  }
}

function Operation({ contract, file, isExample, compact }: { contract: Contract; file: string; isExample: boolean; compact?: boolean | undefined }) {
  return (
    <div className="flex min-w-0 flex-col gap-2.5 text-xs" data-contract={`${contract.method} ${contract.path}`}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="rounded-sm bg-surface-3 px-1.5 font-mono font-semibold text-fg">{contract.method}</span>
        <span className="font-mono text-fg">{contract.path}</span>
        {contract.operationId && <span className="font-mono text-fg-3">{contract.operationId}</span>}
      </div>
      {contract.summary && <p className="m-0 text-fg">{contract.summary}</p>}
      {contract.description && !compact && <p className="m-0 text-fg-2">{contract.description}</p>}
      <p className="m-0 text-fg-3">
        From {file} ({contract.source}){isExample && <span className="tag tag-simulated ml-1.5">example spec</span>}
      </p>

      {contract.parameters.length > 0 && (
        <Part title="Parameters">
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {contract.parameters.map((p) => (
              <li key={`${p.in}:${p.name}`}>
                <FieldLine node={{ ...p.schema, name: p.name, required: p.required, description: p.description ?? p.schema.description }} extra={p.in} />
              </li>
            ))}
          </ul>
        </Part>
      )}

      {contract.requestBody && (
        <Part title={`Request body · ${contract.requestBody.contentType}${contract.requestBody.required ? '' : ' (optional)'}`}>
          <SchemaTree node={contract.requestBody.schema} />
          <Example label="Example request" value={contract.requestBody.example} />
        </Part>
      )}

      <Part title="Responses">
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {contract.responses.map((r) => (
            <li key={r.status}>
              <Response response={r} />
            </li>
          ))}
        </ul>
      </Part>
    </div>
  );
}

function Part({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    // A group, not a landmark: a contract can show twice on a page (step detail and process arrow).
    <div role="group" aria-labelledby={id} className="flex flex-col gap-1">
      <Kicker id={id} as="span" className="normal-case">
        {title}
      </Kicker>
      {children}
    </div>
  );
}

const STATUS_TONE = (status: string) => (status.startsWith('2') ? 'border-ok text-ok-fg' : status.startsWith('4') || status.startsWith('5') ? 'border-warn text-warn-fg' : 'border-line-strong text-fg-2');

function Response({ response }: { response: ContractResponse }) {
  return (
    <details className="group rounded-md border border-line px-2 py-1" data-response={response.status} open={response.status.startsWith('2')}>
      <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-2">
        <span className={cx('rounded-sm border px-1 font-mono font-semibold', STATUS_TONE(response.status))}>{response.status}</span>
        <span className="text-fg">{response.description}</span>
        {response.schema && <span className="font-mono text-fg-3">{schemaTypeName(response.schema)}</span>}
        <span aria-hidden="true" className="ml-auto text-fg-3 group-open:rotate-90">
          ›
        </span>
      </summary>
      <div className="mt-1 flex flex-col gap-1">
        {response.headers.length > 0 && <p className="m-0 text-fg-3">Headers: {response.headers.join(', ')}</p>}
        {response.schema ? (
          <>
            <p className="m-0 text-fg-3">{response.contentType}</p>
            <SchemaTree node={response.schema} />
            <Example label={`Example ${response.status} response`} value={response.example} />
          </>
        ) : (
          <p className="m-0 text-fg-3">No body.</p>
        )}
      </div>
    </details>
  );
}

/** A schema as nested lists: each field with its type, required mark, constraints, and description. */
function SchemaTree({ node, depth = 0 }: { node: SchemaNode; depth?: number }) {
  const children = node.type === 'array' ? node.items?.properties : node.properties;
  if (node.type === 'oneOf' && node.variants) {
    return (
      <div className="flex flex-col gap-1">
        <p className="m-0 text-fg-2">One of {node.variants.length}:</p>
        <ul className="m-0 flex list-none flex-col gap-1 border-l border-line pl-2.5">
          {node.variants.map((v, i) => (
            <li key={i}>
              <span className="font-mono text-fg">{schemaTypeName(v)}</span>
              {depth < 6 && <SchemaTree node={v} depth={depth + 1} />}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (!children?.length || node.cycle) return null;
  return (
    <ul className={cx('m-0 flex list-none flex-col gap-1 p-0', depth > 0 && 'mt-1 border-l border-line pl-2.5')}>
      {children.map((child) => (
        <li key={child.name}>
          <FieldLine node={child} />
          {depth < 6 && (child.type === 'object' || child.type === 'array' || child.type === 'oneOf') && <SchemaTree node={child} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  );
}

function FieldLine({ node, extra }: { node: SchemaNode; extra?: string }) {
  const details = [extra, node.format, ...node.constraints, node.enum ? `one of ${node.enum.map((v) => JSON.stringify(v)).join(', ')}` : undefined].filter(Boolean);
  return (
    <span className="flex flex-wrap items-baseline gap-x-1.5" data-field={node.name}>
      <span className="font-mono text-fg">{node.name}</span>
      <span className="font-mono text-accent-fg">{schemaTypeName(node)}</span>
      {node.required ? <span className="text-warn-fg">required</span> : <span className="text-fg-3">optional</span>}
      {details.length > 0 && <span className="font-mono text-fg-3">{details.join(' · ')}</span>}
      {node.cycle && <span className="text-fg-3">(defined above)</span>}
      {node.description && <span className="basis-full text-fg-2">{node.description}</span>}
    </span>
  );
}

function Example({ label, value }: { label: string; value: unknown }) {
  if (value === undefined) return null;
  return (
    <details className="rounded-md bg-surface-2">
      <summary className="cursor-pointer px-2 py-1 text-fg-2">{label}</summary>
      <pre aria-label={label} className="m-0 max-h-64 overflow-auto px-2 pb-2 font-mono text-[11px] text-fg">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}
