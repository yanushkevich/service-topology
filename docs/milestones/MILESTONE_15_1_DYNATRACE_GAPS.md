# Milestone 15.1 — Dynatrace: hosts, topics and queues, and the documented metric join

**Status:** implemented 2026-10-15 (closeout in `docs/IMPLEMENTATION_PLAN.md`); not yet verified against a real tenant. Backend: B12.1. Amends ADR-034. Spec: `docs/DYNATRACE_CONNECTOR.md` (Revision 2).

**Source:** product owner, "continue implementation" after Milestone 15, whose closeout listed these gaps.

## Today
- **Services on VMs have no containment.** The domain has no host level, so a service outside Kubernetes floats.
- **Messaging is invisible.** Smartscape documents no topic or queue nodes, so channels and their producers and consumers stay authored.
- **The metric join may miss.** Metrics are joined through the classic ID (`dt.entity.service` against `id_classic`). Dynatrace's own service docs join on `dt.smartscape.service`, the Smartscape ID.

## Design
1. **The metric join.**
   - `service-metrics` groups by `dt.smartscape.service`, which is the node `id`.
   - A record that still carries `dt.entity.service` falls back to the classic ID.
2. **Hosts.**
   - A new resource type `host` is a containment level, like a cluster or a namespace. This is a domain change in TypeScript, Go, the schema, and the fixtures.
   - New queries: `hosts` (`smartscapeNodes HOST`) and `service-runs-on` (`runs_on` edges from services to hosts).
   - A service with no Kubernetes containment that runs on exactly one host gets that host as its `resourceId`.
   - A service on several hosts gets none, and the preview notes it (`service-on-several-hosts`): an instance has one resource.
   - Hosts take health from problems, like the other nodes.
3. **Topics and queues, from messaging metrics.**
   - New queries: `messaging-publish` and `messaging-receive` (`dt.service.messaging.publish.count` and `.receive.count`, by service, `messaging.destination.name`, and `messaging.system`, over the discovery window).
   - **Type:** Kafka, SNS, Event Hubs, Pub/Sub, Pulsar, and RocketMQ destinations are topics. A RabbitMQ publish goes to an exchange, and a RabbitMQ receive comes from a queue. Every other system's destinations are queues.
   - **Identity:** one channel per tenant, system, destination, and environment: `dt-<tenant>-<system>-<destination slug>-<environment>`. Its `metadata.dynatrace` holds `{tenant, system, destination}`.
   - **Relationships** follow the existing convention: producer → channel and channel → consumer. They are asynchronous; the protocol is `kafka`, `rabbitmq`, or `other`.
   - **Authored channels** with the same type, name, and environment (the environment may be inherited from a broker) are linked, so event types keep working.
4. **Not done:** metrics on calls. Per-call counts need spans (`fetch spans`); no documented metric splits requests by caller.

## Phases (scope `m15.1`, backend `b12.1`)
1. **Domain:** the `host` resource type in TypeScript, Go, the schema, labels, and glyphs; regenerated fixtures.
2. **Connector:** the queries, the mapping, the channel matching in the reconcile, and the fixture.
3. **Close-out:**
   - docs;
   - `make check`, `make test-integration`, `make contract-check`, and `npm run check`;
   - the real-browser audit of the Dynatrace settings and the inspector.

## Acceptance criteria
- Against the fake tenant:
  - a single-host service runs in its host;
  - a several-host service has no `resourceId` and is noted;
  - a host problem makes the host's health unavailable (tested).
- Kafka destinations become topics, RabbitMQ publish destinations exchanges and receive destinations queues, each with producer → channel → consumer relationships (tested).
- An authored topic with the same name in the same environment, inherited from its broker, is linked, not duplicated (tested).
- Metrics join on `dt.smartscape.service`; a classic-ID record still joins (tested).
- `host` passes validation as containment only, and both stacks' enumerations match the schema (contract and fields tests).
