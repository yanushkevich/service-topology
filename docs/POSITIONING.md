# Positioning and Differentiation Hypothesis

**Status: unvalidated hypothesis (2026-10-11).** No user interviews or usability studies have been run yet. Statements about other products describe their *publicly stated focus* at a category level, written from general knowledge without a dated review of their current documentation. **Verify against current vendor docs before using any of this externally.** Nothing here claims this prototype is better than any product.

## Hypothesis (PRODUCT_SPEC §I)
> A mock-first, integration-ready, cross-environment topology workbench that combines a normalized service registry, explainable dependency/failure simulation, synchronized 2D and optional 3D exploration, and shareable topology context across cloud and on-premises systems.

The unmet need it bets on: *platform/SRE and architecture teams need one explainable picture of what runs where and what talks to what, across clouds, on-prem, and messaging, plus a way to reason about failure impact. They need it before (or without) full telemetry coverage, and they need to share that picture.*

## What this prototype does not have (read first)
- **No real data:** every entity is mock and all telemetry is simulated. Products below build their topology from real catalogs or telemetry. That is the core of their value and absent here.
- No discovery, agents, tracing, alerting, ownership workflows, or plugin ecosystem.
- No authentication, tenancy, or retention.

Any comparison is therefore about *workflow fit and model design*, not data coverage or maturity.

## Workflow comparison (by publicly stated focus)

Legend: ● central to the product's stated purpose · ◐ adjacent or partial · ○ not the stated focus · ? unknown (verify)

| Workflow | Backstage (software catalog / developer portal) | Datadog Service Map (APM) | Dynatrace (Smartscape topology) | Kiali (Istio service mesh console) | This prototype |
|---|---|---|---|---|---|
| Ownership/metadata catalog of services | ● | ◐ | ◐ | ○ | ◐ registry (mock) |
| Runtime dependency map from observed telemetry | ○ | ● | ● | ● (mesh traffic) | ○ none: relationships are modeled, not observed |
| One model across AWS/Azure/GCP/on-prem/SaaS | ◐ (catalog is source-agnostic) | ? | ? | ○ (mesh-scoped) | ◐ modeled explicitly, mock only |
| Kafka topics / RabbitMQ queues as first-class nodes | ? (via plugins) | ? | ? | ○ | ● in the model |
| Explicit containment (account → cluster → namespace) separate from calls | ◐ | ? | ● (topology layers) | ◐ (namespaces) | ● |
| Explainable what-if failure propagation | ○ | ? | ? | ○ | ● rule-based, simulated |
| Topology history / compare | ? | ? | ? | ? | ◐ fixtures + captures |
| Shareable deep links to an exact view | ◐ | ◐ | ◐ | ◐ | ● versioned URL state |
| Synchronized 2D + optional 3D exploration | ○ | ○ | ? | ○ | ● (3D unmeasured on GPU) |
| Works before telemetry exists (design/planning) | ● (catalog-first) | ○ | ○ | ○ | ● (mock-first) |

What the table suggests (to test, not to claim):
- The closest overlap is **Backstage** for the catalog side and **APM/observability tools** for the map side. The candidate gap is the *combination*: one normalized model spanning environments and messaging, explainable failure reasoning, and shareable context, usable before full telemetry.
- Telemetry-driven tools likely beat any modeled map on accuracy wherever they are deployed. A realistic position is **complementary**: ingest from catalogs and observability tools (`API_CONTRACT.md` adapters) rather than replace them.
- Several cells are "?". Each one needs checking against current docs before the comparison is used.

## Validation plan
1. **Desk check (1 day):** fill every "?" from current public docs and record source links and dates in this file.
2. **Interviews (6–8 people):** platform/SRE engineers and architects from organizations with ≥ 2 cloud providers or cloud + on-prem, and asynchronous messaging. Ask:
   - how they answer "what breaks if X fails?" today;
   - which tools they use;
   - where the answer is missing or untrusted.
3. **Task study (5 participants):** with the prototype vs. their current tools, time and correctness on three tasks:
   - find an entity's environment, owner, and host;
   - list everything affected if a topic or database fails, and explain why;
   - share an exact view with a colleague.
4. **Success signals:** at least half of interviewees describe the cross-environment / messaging / "why is this affected" gap unprompted; task correctness at least equals current tools; at least 3 participants would want their real data connected.
5. **Kill or pivot criteria:** existing tools already answer the failure-impact question to participants' satisfaction, or the value depends entirely on telemetry the product cannot get. Then pivot to an adapter or visualization layer for existing tools, or stop.

## Messaging rules until validated
- Say "workbench", "modeled", and "simulated"; never "live", "real-time", or "auto-discovered".
- Do not claim to replace or outperform Backstage, Datadog, Dynatrace, or Kiali.
- Present simulation as reasoning support with stated rules, not as prediction.
