# Alert Manager x OTEL Datasets Roadmap

## Vision

Transform the Alert Manager from an isolated alerting tool into an integrated observability correlation hub by plugging into the same OTEL dataset fabric the APM plugin uses.

## Phase Status

| Phase | Status | Description |
|-------|--------|-------------|
| **Phase 1** | **Done** | OTEL service discovery, APM config reading, Services tab |
| **Phase 2** | **Done** | SLO suggestion engine based on discovered metrics |
| **Phase 3** | **Done** | Cross-signal correlation (traces + logs on alerts) |
| **Phase 4** | Not started | Bidirectional deep links (Alert Manager <-> APM) |
| **Phase 5** | Not started | Service health dashboard with topology map |
| **Phase 6** | Not started | Intelligent root cause suggestion engine |

---

## Phase 1: Dataset Discovery & Service Registry (DONE)

**Goal**: Discover OTEL services and show them with SLO/alert enrichment.

**What was built:**
- `OtelServiceDiscoveryProvider` interface + `isOtelProvider()` type guard in `common/types.ts`
- `OpenSearchOtelProvider` — queries `otel-v1-apm-service-map*` via DSL composite aggregation
- `OtelServiceDiscoveryService` — stale-while-revalidate caching + SLO/alert cross-reference enrichment
- `ApmConfigReader` — reads APM dataset config from `correlations` saved objects
- `MockOtelProvider` — 8 mock services matching existing SLO/alert data
- Service route handlers + API client methods
- Services tab with stat cards, searchable table, detail flyout with dependencies/signals
- 22 unit tests + 10 Cypress E2E tests

---

## Phase 2: SLO Suggestion Engine (DONE)

**Goal**: For every discovered OTEL service, auto-suggest SLOs based on available metrics.

**What was built:**
- 2 OTEL-native SLO templates: Span Availability (`request`, `fault=0`) and Span Latency P99 (`latency_seconds_bucket`)
- `SloSuggestionEngine` class with 5 detection patterns (HTTP, gRPC, OTEL span) and dependency-aware suggestions
- `buildPrefilledSloInput()` / `buildDependencyPrefilledSloInput()` pure functions for one-click SLO creation
- API routes: `GET /api/alerting/services/{name}/slo-suggestions` and `GET /api/alerting/services/badges`
- Framework-agnostic handlers (`suggestion_handlers.ts`) + wiring in both OSD plugin and standalone server
- "SLO Coverage" column in services table showing "X of Y suggested" badges
- "Suggested SLOs" panel in service detail flyout with confidence badges and one-click Create buttons
- SLO wizard `prefill` prop for pre-filling all fields from a suggestion
- Covered suggestions are dimmed with "Created" badge
- Dependency SLO suggestions using `remoteService` label and `service_dependency` source type
- OTEL mock data additions (metrics, labels, label values) for standalone testing
- 27 new unit tests (engine + handlers) + 12 new Cypress E2E tests

---

## Phase 3: Cross-Signal Correlation on Alerts (DONE)

**Goal**: Show correlated traces and logs from OTEL datasets when viewing an alert or SLO breach.

**What was built:**
- `AlertCorrelationProvider` interface + `isCorrelationProvider()` type guard in `common/types.ts`
- `OpenSearchCorrelationProvider` — queries `ss4o_traces-*-*` and `ss4o_logs-*-*` via DSL
- `AlertCorrelationService` — orchestrates cross-signal correlation with caching (2-min TTL)
- Time window intelligence: +/- 5 min expansion, 3-window sampling for long-running alerts (>30 min)
- Failure mode analysis: groups error traces by attributes to surface dominant failure patterns
- `MockCorrelationProvider` — realistic mock data for 3 services with per-service error patterns
- Correlation route handlers + API client methods (POST `/api/alerting/correlations`)
- `AlertCorrelationPanel` React component with Traces/Logs/Metrics sub-tabs
- Integrated into alert detail flyout as "Cross-Signal Correlations" accordion (conditionally shown when alert has `service` label)
- Failure modes summary panel showing "78% of errors were connection_refused to payment-db"
- Sampling notice for long-running alerts
- 45 new unit tests (service + provider + handlers + UI component) + 8 Cypress E2E tests

### 3.1 — Alert Correlation Panel

"Correlations" accordion in alert detail flyout with sub-tabs:

**Traces**: Query `ss4o_traces-*-*` for error spans (status.code=2) matching alert's service + time window
**Logs**: Query `ss4o_logs-*-*` for ERROR/FATAL entries matching service + time window
**Metrics**: Show correlated metric data points (extensible via Prometheus queryRange)

### 3.2 — Time Window Intelligence

- Expands search window by +/- 5 minutes from alert active period
- For alerts >30 minutes, samples traces from start, middle, and recent windows (deduped by spanId)

### 3.3 — SLO Burn Rate -> Trace Correlation

- Accepts optional `sloQuery` parameter for burn rate metric enrichment
- Groups error traces by `exception.message`, `peer.service`, `otel.status_description`
- Surfaces top 5 dominant failure modes with percentage breakdown and example trace IDs

---

## Phase 4: Deep Links (Bidirectional)

**Goal**: Seamless navigation between Alert Manager and APM using `navigateToApp()`.

### 4.1 — Alert Manager -> APM

| From | Target |
|------|--------|
| Alert with `service` label | APM service details with time range |
| Correlated trace row | Trace explorer with traceId |
| Correlated log entry | Log explorer with query |
| SLO for a service | APM service overview |
| Service on Services tab | APM service map focused on service |

### 4.2 — APM -> Alert Manager

Register Alert Manager as a data source on APM service details page:
- **Active Alerts Panel**: Badge count + severity breakdown + "View All" link
- **SLO Health Badges**: SLO attainment + error budget gauge
- **"Create SLO" nudge**: When service has no SLOs, suggest creation

### 4.3 — URL-Based Routing in Alert Manager

Add hash-based routing:
```
#/alerts/{id}       -> Alert detail with correlation panel
#/rules/{id}        -> Rule detail
#/slos/{id}         -> SLO detail
#/services          -> Services tab
#/services/{name}   -> Service detail
```

---

## Phase 5: Service Health Dashboard & Topology

**Goal**: Unified view combining service map topology with alerting/SLO health.

### 5.1 — Service Health Overview

Three-panel layout:
- **Left**: Service list with health indicators
- **Center**: Topology graph with SLO attainment on nodes, alert counts on badges
- **Bottom**: Active incidents with dependency chain

### 5.2 — Topology Node Details

Click a node to see: SLO status, active alerts, signal links (traces/logs/APM).

### 5.3 — Dependency Impact Propagation

When a service has firing alerts, highlight upstream services (blast radius).

### 5.4 — Reuse APM's CelestialMap

Overlay Alert Manager data on the same `@osd/apm-topology` CelestialMap component.

---

## Phase 6: Intelligent Root Cause Suggestions

**Goal**: Proactively suggest root causes by synthesizing all signals.

### 6.1 — Coverage Gaps Report

Analyze service inventory vs existing SLOs, show % coverage per service.

### 6.2 — Alert-Time Root Cause Suggestion

When alert fires: pull error traces + logs, group by attribute, check dependency alerts, synthesize narrative.

### 6.3 — SLO Impact Forecasting

"At current burn rate, error budget exhausted in 2h 14m"

### 6.4 — Cross-Service Incident Grouping

Detect temporal correlation, use dependency graph to identify root service, group into incidents.

---

## Dependency Map

```
Phase 1 (DONE) ─────┐
                     ├──> Phase 3: Cross-Signal Correlation
Phase 2 ─────────────┤        |
                     │        v
                     ├──> Phase 4: Deep Links (bidirectional)
                     │        |
                     │        v
                     └──> Phase 5: Service Health Dashboard
                                |
                                v
                          Phase 6: Intelligent RCA Engine
```

## Execution Priority

| Phase | Value | Effort | Priority |
|-------|-------|--------|----------|
| Phase 2 — SLO Suggestions | Drives SLO adoption | Medium | **High — next** |
| Phase 4 — Deep Links | Connects plugins | Medium | **High — after Phase 2** |
| Phase 3 — Correlation | Core RCA | Large | **After Phase 4** |
| Phase 5 — Topology | Single pane of glass | Large | **After Phase 3** |
| Phase 6 — Intelligent RCA | Differentiator | Large | **Last** |
