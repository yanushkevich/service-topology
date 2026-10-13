# Milestone 14 — Real data: from example data to observed data

**Status:** proposed, **on hold** (2026-10-12). It waits for the product owner's answers to `docs/REAL_DATA_INTEGRATION.md` §6. Do not start without them, except Phase 1 if the product owner explicitly asks.

**Read first:** `docs/REAL_DATA_INTEGRATION.md`; `docs/DECISIONS.md` ADR-030 (proposed), ADR-021, ADR-022, ADR-027, ADR-029; `docs/TRANSIT_BOARD.md` "Data sources"; `docs/CONVENTIONS.md` §4.

## Phases (to be confirmed when resumed)
1. **Contract freeze and HTTP repository.**
   - JSON Schemas for the transit board, flow stats, and business transactions, with the example repository contract-tested against them.
   - Backend endpoints serving the example data.
   - `HttpTransitRepository` behind `?source=api`.
   - This phase is independent of the open questions.
2. **Declared data:** spec, resilience-config, and CronJob ingestion pushed from CI.
3. **Metrics:** step statistics from histograms, policy states, and pool usage.
4. **Trace aggregation:** routes, step shares, retries, tables, and replay from the trace store.
5. **Business transactions:** business key in traces, orchestrator history, and event correlation.
6. **Health:** alerts and SLOs into the topology.

## Acceptance criteria (draft)
- The UI is unchanged when switching between example and real data. Read models validate against the frozen schemas.
- Every value shows its provenance, freshness, and sample size. Nothing example or simulated is called live.
- Example sources can be deleted per service without UI changes.
- Aggregates use histograms or digests, not averaged percentiles. Alias resolution is explicit and editable.
