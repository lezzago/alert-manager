# Alert Manager x OTEL Datasets Roadmap

## Vision

Transform the Alert Manager from an isolated alerting tool into an integrated observability correlation hub by plugging into the same OTEL dataset fabric the APM plugin uses.

## Phase Status

| Phase | Status | Description |
|-------|--------|-------------|
| **Phase 1** | **Done** | OTEL service discovery, APM config reading, Services tab |
| **Phase 2** | **Done** | SLO suggestion engine based on discovered metrics |
| **Phase 3** | **Done** | Cross-signal correlation (traces + logs on alerts) |
| **Phase 4** | **Done** | Bidirectional deep links (Alert Manager <-> APM) |
| **Phase 5** | **Done** | Service health dashboard with topology map |
| **Phase 6** | **Done** | Intelligent root cause suggestion engine |

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

## Phase 4: Deep Links — Bidirectional (DONE)

**Goal**: Seamless navigation between Alert Manager and APM using `navigateToApp()`.

**What was built:**
- Hash-based URL routing: `#/alerts`, `#/alerts/{dsId}/{alertId}`, `#/slos/{id}`, `#/services/{name}`, etc.
- `useHashRouting` hook — bidirectional sync between URL hash and component state (tab + flyout)
- `NavigationService` — wraps OSD `navigateToApp()` for cross-app SPA navigation, URL fallback for standalone
- Deep link URL builders in `common/deep_links.ts`: APM service, trace explorer, log explorer URLs
- Clickable trace IDs in correlation panel → APM Trace Explorer
- Clickable log trace IDs → APM Trace Explorer
- "View all logs" link → Log Explorer with service filter
- "View in APM" button in service detail flyout → APM service details
- "View in APM" action in alert detail flyout for alerts with `service` label
- Service health API: `GET /api/alerting/services/{name}/health` — enables APM to show Alert Manager data
- `core.application` threaded from OSD plugin mount → NavigationService → components
- 38 new unit tests (deep_links + navigation_service + service_health_handlers)
- 12 new Cypress E2E tests (hash routing, APM links, service health API)

### 4.1 — Alert Manager -> APM

| From | Target | Implementation |
|------|--------|----------------|
| Alert with `service` label | APM service details with time range | `NavigationService.navigateToApmServiceFromAlert()` |
| Correlated trace row | Trace explorer with traceId | Clickable `EuiLink` → `navigateToTrace()` |
| Correlated log entry | Log explorer with query | "View all logs" link → `navigateToLogs()` |
| SLO for a service | APM service overview | Via service label navigation |
| Service on Services tab | APM service map focused on service | "View in APM" button → `navigateToApmService()` |

### 4.2 — APM -> Alert Manager

Service health API enables external apps to query Alert Manager data:
- `GET /api/alerting/services/{name}/health` returns alert count, severity breakdown, SLO summaries, deep link URL
- Response includes `alertManagerUrl` hash route for linking back to Alert Manager

### 4.3 — URL-Based Routing in Alert Manager

Hash-based routing with bidirectional URL ↔ state sync:
```
#/alerts                    -> Alerts tab
#/alerts/{dsId}/{alertId}   -> Alert detail flyout
#/rules                     -> Rules tab
#/slos                      -> SLOs tab
#/slos/{id}                 -> SLO detail flyout
#/services                  -> Services tab
#/services/{name}           -> Service detail flyout
#/routing                   -> Routing tab
#/suppression               -> Suppression tab
```

---

## Phase 5: Service Health Dashboard & Topology (DONE)

**Goal**: Unified view combining service map topology with alerting/SLO health.

**What was built:**
- `TopologyNode`, `TopologyEdge`, `TopologyGraph`, `ActiveIncident` types in `common/topology_types.ts`
- `TopologyService` pure functions: `buildTopologyGraph()`, `computeHealthLevel()`, `computeBlastRadius()`, `computeFullBlastRadius()`, `extractActiveIncidents()`
- `ServiceHealthDashboard` component — three-panel layout (service list + topology graph + active incidents)
- `TopologyGraphView` component — ECharts force-directed graph with health-colored nodes, alert badges, blast radius highlighting
- View toggle in Services tab: switch between List (table) and Topology (dashboard) views
- Health computation: critical (alerts or EB<10%), degraded (EB 10-30%), healthy (EB>30%), unknown (no SLOs)
- Blast radius visualization: BFS through reverse dependency graph, highlights upstream impacted services
- Incident focus: click an incident to highlight its blast radius in the graph
- Node tooltips showing service name, health, alert count, SLO count, error budget, dependencies
- 25 new unit tests (topology_service) + 14 new component tests (service_health_dashboard)
- 13 new Cypress E2E tests (view toggle, topology rendering, incidents, blast radius, interactions)

### 5.1 — Service Health Overview

Three-panel layout integrated into Services tab with view toggle:
- **Left panel**: Compact service list sorted by health (critical first), with health indicator border, alert count badges, error budget percentages
- **Center panel**: ECharts force-directed graph with SLO attainment on nodes, alert counts on badges, health-colored borders
- **Bottom panel**: Active incidents with alert count, error budget, and blast radius (upstream impacted services)

### 5.2 — Topology Node Details

Click a node in the graph or service list to open the existing `ServiceDetailFlyout` showing SLO status, active alerts, signal links, dependencies, and suggested SLOs.

### 5.3 — Dependency Impact Propagation

When a service has firing alerts, BFS traverses reverse dependency edges to find all upstream callers. The union of all critical services' blast radii is shown by default. Click a specific incident to focus on its individual blast radius. Non-impacted nodes and edges are dimmed.

### 5.4 — Graph Visualization

Used ECharts graph chart (already bundled as a dependency) instead of APM's CelestialMap to avoid cross-plugin coupling. Force-directed layout with:
- Configurable repulsion and edge length for readable topology
- Adjacency-based emphasis on hover
- Draggable, zoomable canvas
- Responsive resize via ResizeObserver

---

## Phase 6: Intelligent Root Cause Suggestions (DONE)

**Goal**: Proactively suggest root causes by synthesizing all signals.

**What was built:**
- `ErrorBudgetForecast` types + `forecastErrorBudgetExhaustion()` pure function with burn rate computation and time-to-exhaustion prediction
- `CoverageGapReport` types + `computeCoverageGaps()` pure function analyzing service inventory vs SLO/alert coverage
- `IncidentGroup` types + `groupIncidents()` pure function using union-find on dependency graph to cluster co-firing alerts
- `RootCauseAnalysisService` class orchestrating correlation data + topology analysis + template-based narrative synthesis
- 3 framework-agnostic API handlers: `POST /rca`, `GET /coverage-gaps`, `GET /incidents/grouped`
- Routes wired in both OSD plugin (`server/routes/index.ts`) and standalone server (`standalone/server.ts`)
- `ErrorBudgetForecastBadge` React component — inline badge in SLO detail flyout showing "Exhausts in ~2h 30m"
- `RootCauseAnalysisPanel` React component — narrative, confidence badge, root service, dependency alerts, evidence list, suggested actions
- `CoverageGapPanel` React component — summary stats + per-service gap table with severity badges
- Alert detail flyout: "Root Cause Analysis" accordion after correlation panel (conditionally shown for alerts with service label)
- Service Health Dashboard: incidents panel upgraded from flat per-service cards to grouped incident cards with root service, confidence badges, and related services
- Services tab: coverage gap panel showing SLO coverage %, uncovered service count, and per-service gap details
- 50 new unit tests (4 common service tests + 2 component tests) + 14 new Cypress E2E tests

### 6.1 — Coverage Gaps Report

Analyze service inventory vs existing SLOs, show % coverage per service. Pure function `computeCoverageGaps()` uses `EnrichedOtelService` enrichment data (sloCount, activeAlertCount, signals). Gap severity: high (signals but no SLOs/alerts), medium (partial coverage), low (minor gaps), none (fully covered). `CoverageGapPanel` displays summary stats and gap table on the Services tab.

### 6.2 — Alert-Time Root Cause Suggestion

When alert fires: `RootCauseAnalysisService` pulls correlations (reuses `AlertCorrelationService`), builds topology to find alerting dependencies, fetches dependency correlations (top 3), then synthesizes a template-based narrative. Evidence includes failure modes, dependency alerts, error logs, and blast radius. Confidence: high (3+ signal types), medium (2), low (1). `RootCauseAnalysisPanel` displays in alert detail flyout.

### 6.3 — SLO Impact Forecasting

`forecastErrorBudgetExhaustion()` computes burn rate from `(1 - attainment) / (1 - target)` and predicts exhaustion time as `remaining_budget × window / burn_rate`. Severity thresholds: critical (<2h), warning (<24h), ok (>24h). `ErrorBudgetForecastBadge` renders inline in SLO detail flyout — pure client-side computation, no API endpoint needed.

### 6.4 — Cross-Service Incident Grouping

`groupIncidents()` uses union-find on the dependency subgraph restricted to services with active incidents. `findRootService()` identifies the deepest dependency with the most dependents as the root cause. Confidence: high (clear single chain), medium (connected but multiple roots), low (weakly connected). Replaces flat incident cards in `ServiceHealthDashboard` with grouped cards showing root service, confidence, related services, and blast radius.

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
