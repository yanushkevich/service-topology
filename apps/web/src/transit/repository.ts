import { createContext } from 'react';
import { paymentServiceBoard } from './mock/paymentServiceBoard';
import { paymentServiceTraces } from './mock/paymentServiceTraces';
import { exampleFlowStats, exampleTransactions } from './flows/exampleFlows';
import type { FlowStats, FlowTransaction } from './flows/observed';
import type { BusinessFlow } from '../domain/types';
import type { TraceDetail, TraceSummary, TransitBoard, TransitWindow } from './types';
import { exampleOpenApi } from '../contracts/examples';
import type { OpenApiDocument } from '../contracts/openapi';

/**
 * Source of transit boards and traces (ADR-021). Only the example implementation exists; an HTTP
 * one follows when `GET /services/{id}/transit` and `GET /traces/{traceId}/steps` are added to the
 * contract (spec phases 2–4).
 */
export interface TransitRepository {
  /** Shown with the board, e.g. 'Example data'. */
  sourceLabel: string;
  /** The board for a service definition in an environment; null when no entry points are known for it. */
  getBoard(serviceDefinitionId: string, environmentId: string, window: TransitWindow, signal?: AbortSignal): Promise<TransitBoard | null>;
  /** Traces of one line in the window, newest first. */
  getTraces(serviceDefinitionId: string, lineId: string, window: TransitWindow, signal?: AbortSignal): Promise<TraceSummary[]>;
  /** One trace mapped to station ids; null when the id is unknown for this service. */
  getTrace(serviceDefinitionId: string, traceId: string, signal?: AbortSignal): Promise<TraceDetail | null>;
  /** Observed statistics of a business flow (ADR-022); null when none are known. */
  getFlowStats(flow: BusinessFlow, environmentId: string, window: TransitWindow, signal?: AbortSignal): Promise<FlowStats | null>;
  /** Business transactions of a flow in the window, newest first. */
  getTransactions(flow: BusinessFlow, window: TransitWindow, signal?: AbortSignal): Promise<FlowTransaction[]>;
  /** One business transaction by its business key; null when unknown. */
  getTransaction(flow: BusinessFlow, key: string, signal?: AbortSignal): Promise<FlowTransaction | null>;
  /** The service's OpenAPI document and its file name (ADR-029); null when none is known. */
  getOpenApi(serviceDefinitionId: string, signal?: AbortSignal): Promise<{ file: string; doc: OpenApiDocument; isExample: boolean } | null>;
}

const WINDOW_MS: Record<TransitWindow, number> = { '1h': 3_600_000, '24h': 86_400_000, '7d': 604_800_000 };
/** The example "now" the example traces are dated against. */
const EXAMPLE_NOW = Date.parse('2026-10-12T08:45:00Z');

interface ExampleService {
  board: (environmentId: string, window: TransitWindow) => TransitBoard;
  traces: () => Map<string, TraceDetail>;
}

/** Example boards and traces from the prototype: Payment Service only; every other service has none yet. */
export function createExampleTransitRepository(services: Record<string, ExampleService> = { 'payment-service': { board: paymentServiceBoard, traces: paymentServiceTraces } }): TransitRepository {
  return {
    sourceLabel: 'Example data',
    async getOpenApi(serviceDefinitionId, signal) {
      signal?.throwIfAborted();
      const found = exampleOpenApi.get(serviceDefinitionId);
      return found ? { ...found, isExample: true } : null;
    },
    async getBoard(serviceDefinitionId, environmentId, window, signal) {
      signal?.throwIfAborted();
      return services[serviceDefinitionId]?.board(environmentId, window) ?? null;
    },
    async getTraces(serviceDefinitionId, lineId, window, signal) {
      signal?.throwIfAborted();
      const all = [...(services[serviceDefinitionId]?.traces().values() ?? [])].map((t) => t.summary);
      return all
        .filter((t) => t.lineId === lineId && EXAMPLE_NOW - Date.parse(t.startedAt) <= WINDOW_MS[window])
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    },
    async getTrace(serviceDefinitionId, traceId, signal) {
      signal?.throwIfAborted();
      const trace = services[serviceDefinitionId]?.traces().get(traceId.trim());
      return trace ? structuredClone(trace) : null;
    },
    async getFlowStats(flow, _environmentId, window, signal) {
      signal?.throwIfAborted();
      return exampleFlowStats(flow.id, window);
    },
    async getTransactions(flow, window, signal) {
      signal?.throwIfAborted();
      return exampleTransactions(flow)
        .filter((t) => EXAMPLE_NOW - Date.parse(t.startedAt) <= WINDOW_MS[window])
        .map((t) => structuredClone(t));
    },
    async getTransaction(flow, key, signal) {
      signal?.throwIfAborted();
      const wanted = key.trim().toLowerCase();
      const tx = exampleTransactions(flow).find((t) => t.key.toLowerCase() === wanted);
      return tx ? structuredClone(tx) : null;
    },
  };
}

export const TransitRepositoryContext = createContext<TransitRepository>(createExampleTransitRepository());
