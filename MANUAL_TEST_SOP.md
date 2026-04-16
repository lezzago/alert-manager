# Alert Manager OTEL Features — Manual Test SOP (Phases 1-6)

## Prerequisites

- Docker OSD stack running via `./scripts/e2e-osd.sh`
- OSD available at **http://localhost:5601**
- Login: `admin` / `My_password_123!@#`
- Navigate to the Alert Manager workspace (auto-created by the stack)

## Phase 1: OTEL Service Discovery (Services Tab)

### Test Steps

1. Click the **Services** tab
2. Verify **stat cards** at the top show total services, services with SLOs, active alerts
3. Verify the **services table** lists discovered OTEL services (e.g., api-gateway, payment-service, checkout-service, etc.)
4. Click a service row to open the **Service Detail Flyout**
5. In the flyout, verify:
   - Stats row: SLO count, Active Alerts, Error Budget
   - **Signals** panel: shows which telemetry signals are available (traces, logs, metrics)
   - **Dependencies** panel: lists service dependencies as badges
   - **Service Details**: environment, type, SDK language, last seen
6. Close the flyout

### Expected Results
- 8 services discovered from mock OTEL data
- Each service shows its dependencies and available signals
- Services with SLOs show SLO count > 0

---

## Phase 2: SLO Suggestion Engine

### Test Steps

1. On the **Services** tab, look for the **SLO Coverage** column in the table
2. Services should show badges like "2 of 4 suggested" or "0 of 3 suggested"
3. Click a service that has suggestions (e.g., one with "0 of N suggested")
4. In the Service Detail Flyout, scroll to the **Suggested SLOs** panel
5. Verify suggestions show:
   - SLO name and type (HTTP Availability, Span Latency P99, etc.)
   - Confidence badge (high/medium)
   - **Create** button
6. Click **Create** on a suggestion
7. Verify the SLO Creation Wizard opens **pre-filled** with the suggestion's values
8. Cancel the wizard (or complete it to verify full flow)

### Expected Results
- Services have auto-generated SLO suggestions based on available metrics
- Clicking Create pre-fills the wizard with correct metric, service label, and thresholds

---

## Phase 3: Cross-Signal Correlation

### Test Steps

1. Click the **Alerts** tab
2. Click on an alert that has a `service` label (look for alerts on payment-service or order-service)
3. In the Alert Detail Flyout, find the **Cross-Signal Correlations** accordion
4. Expand it (should be open by default)
5. Verify three sub-tabs: **Traces**, **Logs**, **Metrics**
6. **Traces tab**: should show error traces with operation name, duration, timestamp, error status, trace ID
7. **Logs tab**: should show ERROR/FATAL log entries with timestamp, severity, message
8. **Metrics tab**: should show correlated metric data points
9. Above the tabs, check the **Failure Modes** summary — e.g., "78% of errors: Connection refused to payment-db"
10. Click a **trace ID** link — should navigate to APM Trace Explorer (or open in new tab)

### Expected Results
- Correlated traces show error spans (statusCode=2) from the alert's time window
- Failure modes are grouped and ranked by percentage
- Logs show ERROR/FATAL entries matching the service and time window

---

## Phase 4: Bidirectional Deep Links

### Test Steps

1. **Alert Manager -> APM**:
   - Open an alert with a `service` label
   - Look for "View in APM" button → should link to APM service details
   - In correlation panel, click a trace ID → should link to Trace Explorer
   - Click "View all logs" → should link to Log Explorer with service filter

2. **URL Hash Routing**:
   - Note the URL changes as you navigate: `#/alerts`, `#/slos`, `#/services`
   - Open an alert flyout — URL should show `#/alerts/{dsId}/{alertId}`
   - Open a service flyout — URL should show `#/services/{name}`
   - Copy the URL, open in a new tab — should navigate directly to the same view

3. **Service Health API** (for APM integration):
   - Open browser devtools or curl:
     ```
     curl http://localhost:5601/api/alerting/services/payment-service/health
     ```
   - Should return JSON with alertCount, severityBreakdown, SLO summaries, alertManagerUrl

### Expected Results
- Deep links navigate correctly between Alert Manager and APM
- Hash-based URLs are bookmarkable and shareable
- Service health API returns structured data for external consumers

---

## Phase 5: Service Health Dashboard & Topology

### Test Steps

1. Click the **Services** tab
2. Click the **Topology** button in the view toggle (List | Topology)
3. Verify the three-panel layout:
   - **Left panel**: Compact service list sorted by health (critical first)
   - **Center panel**: Force-directed topology graph with health-colored nodes
   - **Bottom panel**: Active Incidents with grouped cards

4. **Topology Graph**:
   - Nodes should be color-coded: green (healthy), yellow (degraded), red (critical), gray (unknown)
   - Edges show dependency relationships (arrows from caller to dependency)
   - Hover over a node to see tooltip: service name, health, alert count, SLO count, error budget

5. **Active Incidents** (bottom panel):
   - Services with firing alerts should appear as incident cards
   - Cards show alert count, health badge, and blast radius (upstream impacted services)

6. **Interactions**:
   - Click a service in the left list → opens Service Detail Flyout
   - Click an incident card → highlights its blast radius in the graph (impacted nodes/edges turn red)
   - Click "Clear focus" to reset blast radius highlighting

7. Switch back to **List** view — stat cards should be preserved

### Expected Results
- Topology graph renders all 8 services with correct dependency edges
- Critical services (with alerts) are red, healthy services are green
- Clicking an incident highlights the blast radius path in the graph

---

## Phase 6: Intelligent Root Cause Suggestions (NEW)

### 6.1 — Coverage Gaps Report

#### Test Steps

1. Click the **Services** tab
2. At the top (above the table/topology), verify the **Coverage Gap Panel**:
   - Summary stats: SLO coverage %, uncovered services count, total services
   - Below the stats, a **table** of services with coverage gaps
3. Verify gap severity badges:
   - **High** (red): services with signals but no SLOs and no alerts
   - **Medium** (yellow): services with alerts but no SLOs, or SLOs with missing signal coverage
   - **Low** (gray): minor gaps like uncovered dependencies
4. Click a service name in the gap table → should open the Service Detail Flyout
5. Check the "Missing" column — shows what's missing (SLOs, traces, logs, dep SLOs)

#### Expected Results
- Panel shows realistic coverage percentages (some services have SLOs, some don't)
- postgres and notification-service likely show as "High" severity gaps
- Fully covered services (api-gateway, payment-service) don't appear in the gap table

### 6.2 — Alert-Time Root Cause Analysis

#### Test Steps

1. Click the **Alerts** tab
2. Click an alert that has a `service` label (e.g., a payment-service alert)
3. In the Alert Detail Flyout, find the **Root Cause Analysis** accordion (below Cross-Signal Correlations)
4. Expand it (should be open by default)
5. Verify the panel shows:
   - **Analysis callout** with a narrative like "78% of errors on payment-service are 'Connection refused to payment-db'. Dependency postgres has 3 firing alerts. postgres is likely the root cause — investigate it first."
   - **Confidence badge**: high/medium/low (colored green/yellow/gray)
   - **Likely root cause**: red badge with the root service name (e.g., "postgres")
   - **Alerting dependencies**: yellow badges showing dependency services with alert counts
   - **Evidence list**: structured evidence items (failure_mode, dependency_alert, error_log, blast_radius)
   - **Suggested next steps**: actionable bullet points

6. Try an alert **without** a service label — the RCA accordion should NOT appear

#### Expected Results
- RCA narrative synthesizes failure modes from correlation data + dependency health from topology
- Root service is identified when a dependency deeper in the chain has alerts
- Evidence includes failure mode percentages, dependency alert counts, and log counts
- Suggested actions are actionable (e.g., "Investigate postgres first")

### 6.3 — SLO Impact Forecasting

#### Test Steps

1. Click the **SLOs** tab
2. Click on an SLO to open the **SLO Detail Flyout**
3. Below the stats row (Attainment, Target, Error Budget, Window), look for the **Forecast** line
4. Verify the forecast badge:
   - **Breached SLOs** (e.g., "Payment Service Reliability"): "Budget exhausted" (red badge)
   - **Warning SLOs** (e.g., "Inventory Service Availability"): "Exhausts in ~Xh Ym" (yellow badge)
   - **Healthy SLOs**: "Budget healthy" (green badge) — only shows when burn rate > 0
   - **No data SLOs**: no badge shown
5. Hover over the badge to see the tooltip with burn rate details

#### Expected Results
- Forecast is computed client-side from existing SLO status data (no API call)
- Breached SLOs correctly show "Budget exhausted"
- Warning SLOs show a human-readable time estimate
- Healthy SLOs with sustainable burn rate show "Budget healthy"

### 6.4 — Cross-Service Incident Grouping

#### Test Steps

1. Click the **Services** tab → switch to **Topology** view
2. In the **Active Incidents** bottom panel, verify grouped incident cards:
   - Cards now show a **root service** (the deepest dependency with alerts)
   - **Confidence badge** (high/medium/low) indicating grouping confidence
   - **Related services**: if multiple services in the group, shows other members as badges
   - **Blast radius**: upstream services impacted beyond the group members
   - **Total alert count**: sum across all grouped services

3. If payment-service and postgres both have alerts and are connected by a dependency:
   - They should appear in a **single group** with postgres as the root service
   - The card should show "Related services: payment-service (2)" or similar

4. Click a grouped incident card → highlights the entire group's blast radius in the topology graph

#### Expected Results
- Co-firing alerts on connected services are grouped into a single incident
- The root service (deepest in dependency chain) is correctly identified
- Unconnected alerting services remain as separate groups
- Clicking a group highlights the full blast radius

---

## Quick API Verification (Optional)

Run these from a terminal to verify the Phase 6 APIs directly:

```bash
# Coverage Gaps
curl -s http://localhost:5601/api/alerting/coverage-gaps | jq '.totalServices, .sloCoveragePercent, .servicesWithoutAnyCoverage'

# Root Cause Analysis
curl -s -X POST http://localhost:5601/api/alerting/rca \
  -H 'Content-Type: application/json' \
  -d '{"alert":{"id":"test","datasourceId":"ds-1","datasourceType":"prometheus","name":"Test","state":"firing","severity":"critical","startTime":"2024-01-01T00:00:00Z","lastUpdated":"2024-01-01T00:05:00Z","labels":{"service":"payment-service"},"annotations":{}}}' \
  | jq '.narrative, .confidence, .rootService'

# Grouped Incidents
curl -s http://localhost:5601/api/alerting/incidents/grouped | jq '.groups | length, .groups[0].rootService, .groups[0].rootCauseConfidence'
```

---

## Troubleshooting

- **Services tab empty**: OTEL service discovery requires mock mode or real `otel-v1-apm-service-map*` index. Docker stack seeds this.
- **No correlations**: Correlation panel only shows for alerts with a `service` label. Check alert labels.
- **Coverage gap panel missing**: Loads asynchronously — wait a moment after services load.
- **Forecast badge not showing**: Only appears for SLOs with non-`no_data` status. Check that SLOs have been seeded.
- **Grouped incidents show single-service groups**: This is expected when alerting services are not connected by dependencies.
