# Alert Manager OTEL Improvements — TODO

## Status of Work Done (improve-cypress-coverage branch)

### Completed in Audit+Fix Session (Apr 16, 2025)

All changes are **uncommitted** on the `improve-cypress-coverage` branch.
Unit tests: 1144/1144 pass. Standalone build needs fix (see Session 2 blockers below).

**Backend fixes (Sanjay track):**
- [x] `alarms_client.ts` — 8 API methods now tag errors with `_error: true` / `_errorMessage`
- [x] `root_cause_analysis_service.ts` — Null guard for missing service in topology
- [x] `incident_grouping_service.ts` — O(N^2) → O(N) precomputed reachability sets
- [x] `alert_correlation_service.ts` + `root_cause_analysis_service.ts` — Cache eviction (MAX=100)
- [x] `rca_handlers.ts`, `coverage_gap_handlers.ts`, `incident_handlers.ts` — HTTP 503 on errors
- [x] `topology_service.ts` — Blast radius tracks actual BFS-traversed edges only
- [x] `otel_service_discovery.ts` — Promise-based refresh lock + batched signal fetch (10/batch)

**Frontend fixes (Chen track):**
- [x] `services_tab.tsx`, `service_detail_flyout.tsx`, `alert_correlation_panel.tsx` — AbortController/cancelled flags
- [x] `root_cause_analysis_panel.tsx`, `coverage_gap_panel.tsx`, `alert_correlation_panel.tsx` — Error states with EuiCallOut + Retry (check `_error` on result, not try/catch)
- [x] `service_health_dashboard.tsx` — GraphErrorBoundary around topology + recovery button
- [x] `services_tab.tsx` — Retry button on error panel
- [x] `alert_detail_flyout.tsx`, `slo_detail_flyout.tsx` — Race condition fix with ID capture
- [x] `use_hash_routing.ts` — pushState for navigation (preserves back button), replaceState for init
- [x] `deep_links.ts` — Quote escaping in service name for URL builders

**Cypress E2E tests (Kai track):**
- [x] `11_correlations.cy.ts` — 8 new UI tests for correlation panel sub-tabs, failure modes
- [x] `14_root_cause.cy.ts` — 12 new UI tests for RCA panel, coverage gaps, forecast badge, incidents
- [x] Total: 159 tests across 14 specs (was 140)

### Partially Completed — Session 2: CelestialMap (started externally)

Someone started Session 2 work. Current state:
- [x] `topology_celestial_graph.tsx` created (176 lines) — CelestialMap wrapper component
- [x] `topology_graph.tsx` deleted — old ECharts component removed
- [x] `service_health_dashboard.tsx` updated — imports `TopologyCelestialGraph`
- [x] `public/__mocks__/apm_topology_mock.tsx` created — test mock for CelestialMap
- [ ] **BLOCKER**: Standalone build fails — `sass`/`sass-loader` deps in `standalone/package.json` conflict with OUI's TypeScript peer dep
- [ ] **BLOCKER**: `npm run e2e` fails because standalone build is broken
- [ ] Cypress topology tests (`13_topology.cy.ts`) may need selector updates for CelestialMap
- [ ] Unit test for CelestialMap component not verified

### Partially Completed — Session 3: Services Table Enhancements (started externally)

Someone started Session 3 work. Current state:
- [x] `metric_sparkline.tsx` created (139 lines) — ECharts sparkline component
- [x] `services_empty_state.tsx` created (171 lines) — Rich onboarding empty state
- [x] `services_tab.tsx` heavily modified (+483 lines) — likely includes sparklines + filters
- [ ] Need to verify sparklines render correctly in standalone mode
- [ ] Need to verify filter sidebar works
- [ ] Cypress tests for new features not written yet

---

## Remaining Sessions (not started)

### Session 4: Extract Data-Fetching Hooks
**Priority: Medium | Effort: Medium**

Create reusable hooks in `public/hooks/`:
- [ ] `use_services.ts` — services list + badges
- [ ] `use_correlations.ts` — correlation result
- [ ] `use_rca.ts` — RCA result
- [ ] `use_coverage_gaps.ts` — gap report
- [ ] `use_slo_suggestions.ts` — suggestions

All hooks must check `(result as any)._error` instead of try/catch (API client never throws).
Refactor components to use hooks. Add unit tests per hook.

### Session 5: Accessibility Pass
**Priority: Medium | Effort: Medium**

- [ ] Replace ~192 hardcoded hex colors in components with OUI design tokens
- [ ] Add ARIA labels to all `role="button"` spans/divs
- [ ] Add `aria-label` to signal badges (T/L/M), health indicators, forecast badge
- [ ] Add ARIA live regions for dynamic data (services table, alert counts)
- [ ] Add tooltips on disabled navigation links explaining why disabled
- [ ] Keyboard navigation testing + focus management for flyouts

### Session 6: Negative Test Suite & Test Hardening
**Priority: High | Effort: Small**

- [ ] Create `cypress/e2e/15_negative_cases.cy.ts` — API failures, empty data, timeout handling
- [ ] Replace all `cy.wait(N)` with `cy.intercept().as()` + `cy.wait('@alias')`
- [ ] Create `cypress/e2e/16_responsive.cy.ts` — mobile/tablet/desktop viewport tests
- [ ] Harden generic selectors to use specific `data-test-subj`

---

## Known Build Issue (committed as-is)

Everything was committed together on `improve-cypress-coverage` with a broken standalone build.
**The very first task on return is to fix this.**

1. **Fix standalone build**: `sass`/`sass-loader` in `standalone/package.json` cause a peer dep conflict with OUI's `typescript@^4.0.5` requirement. Options:
   - Use `--legacy-peer-deps` in the standalone npm install script
   - Remove sass deps if CelestialMap doesn't need them in standalone mode
   - Pin compatible sass versions
   
2. **Verify E2E tests pass**: Once standalone builds, run `npm run e2e` to confirm all 159 tests still pass. Unit tests (1144) pass as of the commit.

3. **Verify Session 2+3 work**: The CelestialMap migration and services table enhancements were started externally and committed without full verification. After fixing the build:
   - Run `npm run e2e` — topology tests (`13_topology.cy.ts`) may need selector updates
   - Manually check the Services tab sparklines and filter sidebar in standalone mode
   - Manually check the Topology view renders CelestialMap correctly

---

## Key Patterns to Remember

- **API error handling**: `alarms_client.ts` catches internally, tags with `_error`. Components check `(result as any)._error`, never try/catch.
- **Cypress flyout clicks**: Click `button` (alerts) or `span[role="button"]` (SLOs) — not table rows.
- **Hash routing**: Uses `pushState` for navigation, `replaceState` for init. Back button works.
- **Cache eviction**: Correlation + RCA services evict entries > 2×TTL when cache exceeds 100.
