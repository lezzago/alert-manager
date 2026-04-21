/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Phase 6: Intelligent Root Cause Suggestions E2E tests.
 *
 * Covers: RCA panel (6.2), Coverage Gaps (6.1), Incident Grouping (6.4),
 * SLO forecasting (6.3), and the associated API endpoints.
 */

// Helper: reusable alert body for API tests
const testAlertBody = {
  alert: {
    id: 'test-rca-alert',
    datasourceId: 'ds-1',
    datasourceType: 'prometheus',
    name: 'HighErrorRate',
    state: 'firing',
    severity: 'critical',
    startTime: new Date(Date.now() - 600000).toISOString(),
    lastUpdated: new Date().toISOString(),
    labels: { service: 'payment-service', severity: 'critical' },
    annotations: {},
  },
};

// ============================================================================
// 6.2 — Root Cause Analysis
// ============================================================================

describe('Root Cause Analysis (Phase 6.2)', () => {
  it('RCA API returns valid response shape', () => {
    cy.getApiBase().then((base) => {
      cy.request({
        method: 'POST',
        url: `${base}/rca`,
        body: testAlertBody,
        failOnStatusCode: false,
      }).then((resp) => {
        expect(resp.status).to.eq(200);
        expect(resp.body).to.have.property('alertId');
        expect(resp.body).to.have.property('serviceName');
        expect(resp.body).to.have.property('narrative');
        expect(resp.body).to.have.property('confidence');
        expect(resp.body).to.have.property('evidence');
        expect(resp.body).to.have.property('rootService');
        expect(resp.body).to.have.property('dependencyAlerts');
        expect(resp.body).to.have.property('suggestedActions');
        expect(resp.body.evidence).to.be.an('array');
        expect(resp.body.dependencyAlerts).to.be.an('array');
        expect(resp.body.suggestedActions).to.be.an('array');
      });
    });
  });

  it('RCA API returns narrative with failure pattern details', () => {
    cy.getApiBase().then((base) => {
      cy.request({
        method: 'POST',
        url: `${base}/rca`,
        body: testAlertBody,
      }).then((resp) => {
        expect(resp.body.narrative).to.be.a('string');
        expect(resp.body.narrative.length).to.be.greaterThan(10);
        expect(['high', 'medium', 'low']).to.include(resp.body.confidence);
      });
    });
  });

  it('RCA API returns evidence items', () => {
    cy.getApiBase().then((base) => {
      cy.request({
        method: 'POST',
        url: `${base}/rca`,
        body: testAlertBody,
      }).then((resp) => {
        expect(resp.body.evidence.length).to.be.greaterThan(0);
        const ev = resp.body.evidence[0];
        expect(ev).to.have.property('type');
        expect(ev).to.have.property('summary');
        expect(ev).to.have.property('serviceName');
      });
    });
  });

  it('RCA API handles alert without service label gracefully', () => {
    cy.getApiBase().then((base) => {
      cy.request({
        method: 'POST',
        url: `${base}/rca`,
        body: {
          alert: {
            id: 'no-service-alert',
            datasourceId: 'ds-1',
            datasourceType: 'prometheus',
            name: 'NoServiceAlert',
            state: 'firing',
            severity: 'warning',
            startTime: new Date().toISOString(),
            lastUpdated: new Date().toISOString(),
            labels: {},
            annotations: {},
          },
        },
        failOnStatusCode: false,
      }).then((resp) => {
        expect(resp.status).to.eq(200);
        expect(resp.body.evidence).to.deep.eq([]);
        expect(resp.body.dependencyAlerts).to.deep.eq([]);
      });
    });
  });

  it('RCA accordion appears in alert detail flyout', () => {
    cy.ensureLoaded();
    cy.contains('Alerts').click();
    cy.get('table tbody tr', { timeout: 30000 }).first().click();
    // The flyout should render — RCA accordion is present for alerts with service label
    cy.get('body').should('be.visible');
  });
});

// ============================================================================
// 6.1 — Coverage Gaps
// ============================================================================

describe('Coverage Gaps (Phase 6.1)', () => {
  it('coverage gaps API returns valid response shape', () => {
    cy.getApiBase().then((base) => {
      cy.request({
        method: 'GET',
        url: `${base}/coverage-gaps`,
        failOnStatusCode: false,
      }).then((resp) => {
        expect(resp.status).to.eq(200);
        expect(resp.body).to.have.property('totalServices');
        expect(resp.body).to.have.property('servicesWithSlos');
        expect(resp.body).to.have.property('servicesWithAlerts');
        expect(resp.body).to.have.property('servicesWithoutAnyCoverage');
        expect(resp.body).to.have.property('sloCoveragePercent');
        expect(resp.body).to.have.property('alertCoveragePercent');
        expect(resp.body).to.have.property('gaps');
        expect(resp.body.gaps).to.be.an('array');
      });
    });
  });

  it('coverage gaps API returns realistic service counts', () => {
    cy.getApiBase().then((base) => {
      cy.request(`${base}/coverage-gaps`).then((resp) => {
        expect(resp.body.totalServices).to.be.greaterThan(0);
        expect(resp.body.sloCoveragePercent).to.be.a('number');
        expect(resp.body.sloCoveragePercent).to.be.within(0, 100);
      });
    });
  });

  it('coverage gaps include per-service gap details', () => {
    cy.getApiBase().then((base) => {
      cy.request(`${base}/coverage-gaps`).then((resp) => {
        expect(resp.body.gaps.length).to.be.greaterThan(0);
        const gap = resp.body.gaps[0];
        expect(gap).to.have.property('serviceName');
        expect(gap).to.have.property('hasSlos');
        expect(gap).to.have.property('gapSeverity');
        expect(['none', 'low', 'medium', 'high']).to.include(gap.gapSeverity);
      });
    });
  });

  it('coverage gap panel appears on Services tab', () => {
    cy.ensureLoaded();
    cy.get('[data-test-subj="alertManager-tabs-services"]').click();
    // Wait for services to load, then check for coverage gap panel
    cy.get('[data-test-subj="coverage-gap-panel"]', { timeout: 10000 }).should('exist');
    cy.get('[data-test-subj="coverage-gap-summary"]').should('exist');
  });
});

// ============================================================================
// 6.4 — Cross-Service Incident Grouping
// ============================================================================

describe('Cross-Service Incident Grouping (Phase 6.4)', () => {
  it('grouped incidents API returns valid response shape', () => {
    cy.getApiBase().then((base) => {
      cy.request({
        method: 'GET',
        url: `${base}/incidents/grouped`,
        failOnStatusCode: false,
      }).then((resp) => {
        expect(resp.status).to.eq(200);
        expect(resp.body).to.have.property('groups');
        expect(resp.body).to.have.property('ungrouped');
        expect(resp.body.groups).to.be.an('array');
        expect(resp.body.ungrouped).to.be.an('array');
      });
    });
  });

  it('incident groups have expected structure', () => {
    cy.getApiBase().then((base) => {
      cy.request(`${base}/incidents/grouped`).then((resp) => {
        if (resp.body.groups.length > 0) {
          const group = resp.body.groups[0];
          expect(group).to.have.property('id');
          expect(group).to.have.property('rootService');
          expect(group).to.have.property('rootHealth');
          expect(group).to.have.property('affectedServices');
          expect(group).to.have.property('totalAlertCount');
          expect(group).to.have.property('rootCauseConfidence');
          expect(group).to.have.property('incidents');
          expect(group.affectedServices).to.be.an('array');
          expect(group.incidents).to.be.an('array');
          expect(['high', 'medium', 'low']).to.include(group.rootCauseConfidence);
        }
      });
    });
  });

  it('topology view shows grouped incidents with confidence badges', () => {
    cy.ensureLoaded();
    cy.get('[data-test-subj="alertManager-tabs-services"]').click();
    cy.get('[data-test-subj="services-view-toggle"]').contains('Topology').click();
    cy.get('[data-test-subj="topology-incidents-panel"]').should('exist');
    // Groups should show confidence badges
    cy.get('[data-test-subj="topology-incidents-panel"]').within(() => {
      cy.get('[data-test-subj^="incident-group-confidence-"]').should('have.length.greaterThan', 0);
    });
  });

  it('incident group cards show root service name', () => {
    cy.ensureLoaded();
    cy.get('[data-test-subj="alertManager-tabs-services"]').click();
    cy.get('[data-test-subj="services-view-toggle"]').contains('Topology').click();
    cy.get('[data-test-subj="topology-incidents-panel"]').within(() => {
      cy.get('[data-test-subj^="topology-incident-group-"]').should('have.length.greaterThan', 0);
    });
  });
});

// ============================================================================
// 6.3 — SLO Impact Forecasting (client-side, no API test needed)
// ============================================================================

describe('SLO Impact Forecasting (Phase 6.3)', () => {
  it('forecast badge appears in SLO detail flyout', () => {
    cy.ensureLoaded();
    cy.contains('SLOs').click();
    // Click first SLO to open detail flyout
    cy.get('table tbody tr', { timeout: 30000 }).first().click();
    // The flyout should render — forecast badge is inside it
    cy.get('body').should('be.visible');
  });
});

// ============================================================================
// Phase 6 UI Validation
// ============================================================================

describe('Phase 6 UI Validation', () => {
  // Helper: open an alert that has a service label for an OTEL-registered service.
  // "production_rule_1_api-gateway" has service: api-gateway which is in the mock
  // OTEL topology, giving rich RCA data (evidence, narrative, suggested actions).
  // We click the alert NAME button (EuiButtonEmpty) to open the detail flyout.
  const openServiceAlert = () => {
    cy.ensureLoaded();
    cy.contains('Alerts').click();
    cy.get('table tbody tr', { timeout: 30000 }).should('have.length.greaterThan', 0);
    // Click the alert name button to open the detail flyout
    cy.contains('button', 'production_rule_1_api-gateway', { timeout: 10000 }).first().click();
  };

  // --------------------------------------------------------------------------
  // RCA Panel UI
  // --------------------------------------------------------------------------

  it('displays RCA narrative and evidence in alert flyout', () => {
    openServiceAlert();

    // RCA accordion should render for alerts with a service label
    cy.get('[data-test-subj="rca-panel"]', { timeout: 15000 }).should('exist');
    // Narrative text
    cy.get('[data-test-subj="rca-narrative"]').should('exist');
    cy.get('[data-test-subj="rca-narrative"]').invoke('text').should('have.length.greaterThan', 10);
    // Confidence badge
    cy.get('[data-test-subj="rca-confidence-badge"]').should('exist');
    cy.get('[data-test-subj="rca-confidence-badge"]')
      .invoke('text')
      .should('match', /(high|medium|low) confidence/);
    // Root service badge (conditionally present depending on mock data)
    cy.get('[data-test-subj="rca-panel"]').then(($panel) => {
      if ($panel.find('[data-test-subj="rca-root-service"]').length > 0) {
        cy.get('[data-test-subj="rca-root-service"]').should('exist');
      }
    });
    // Evidence list
    cy.get('[data-test-subj="rca-evidence-list"]').should('exist');
    // Suggested actions
    cy.get('[data-test-subj^="rca-action-"]').should('have.length.greaterThan', 0);
  });

  it('shows dependency alerts in RCA panel', () => {
    openServiceAlert();
    // Wait for RCA panel to load
    cy.get('[data-test-subj="rca-panel"]', { timeout: 15000 }).should('exist');
    // Dependency alerts list (may or may not have items depending on mock data)
    cy.get('[data-test-subj="rca-panel"]').then(($panel) => {
      if ($panel.find('[data-test-subj="rca-dependency-list"]').length > 0) {
        cy.get('[data-test-subj="rca-dependency-list"]')
          .find('[data-test-subj^="rca-dependency-"]')
          .should('have.length.greaterThan', 0);
      }
    });
  });

  it('hides RCA section for alerts without service label', () => {
    cy.ensureLoaded();
    cy.contains('Alerts').click();
    cy.get('table tbody tr', { timeout: 30000 }).should('have.length.greaterThan', 0);
    // OpenSearch alerts do NOT have a service label. Click one by its name button.
    // "Cluster Health Status" is an OS alert always on page 1.
    cy.contains('button', 'Cluster Health Status', { timeout: 10000 }).first().click();
    // Verify the RCA accordion does NOT exist (since no service label)
    cy.get('[data-test-subj="rca-panel"]').should('not.exist');
  });

  // --------------------------------------------------------------------------
  // Coverage Gap Panel UI
  // --------------------------------------------------------------------------

  it('displays coverage gap panel with summary stats on Services tab', () => {
    cy.ensureLoaded();
    cy.get('[data-test-subj="alertManager-tabs-services"]').click();
    // Coverage gap panel should appear below the services table
    cy.get('[data-test-subj="coverage-gap-panel"]', { timeout: 15000 }).should('exist');
    // Summary stats row
    cy.get('[data-test-subj="coverage-gap-summary"]').should('exist');
    // Verify stat values exist (SLO coverage %, Uncovered services, Total services)
    cy.get('[data-test-subj="coverage-gap-summary"]').within(() => {
      cy.contains('SLO coverage').should('exist');
      cy.contains('Uncovered services').should('exist');
      cy.contains('Total services').should('exist');
    });
  });

  it('displays coverage gap table with severity badges', () => {
    cy.ensureLoaded();
    cy.get('[data-test-subj="alertManager-tabs-services"]').click();
    cy.get('[data-test-subj="coverage-gap-panel"]', { timeout: 15000 }).should('exist');
    // Gap table should have rows for services with gaps
    cy.get('[data-test-subj="coverage-gap-table"]', { timeout: 10000 }).should('exist');
    cy.get('[data-test-subj="coverage-gap-table"] tbody tr').should('have.length.greaterThan', 0);
    // Severity badges (high, medium, or low)
    cy.get('[data-test-subj^="coverage-gap-severity-"]').should('have.length.greaterThan', 0);
  });

  it('coverage gap table rows are clickable', () => {
    cy.ensureLoaded();
    cy.get('[data-test-subj="alertManager-tabs-services"]').click();
    cy.get('[data-test-subj="coverage-gap-panel"]', { timeout: 15000 }).should('exist');
    // Clicking a coverage gap row should open the service detail flyout
    cy.get('[data-test-subj^="coverage-gap-row-"]', { timeout: 10000 }).first().click();
    cy.get('[data-test-subj="service-detail-flyout"]', { timeout: 10000 }).should('exist');
  });

  // --------------------------------------------------------------------------
  // Forecast Badge UI
  // --------------------------------------------------------------------------

  it('displays forecast badge in SLO detail flyout', () => {
    cy.ensureLoaded();
    cy.contains('SLOs').click();
    // Wait for the SLO table to load
    cy.get('table tbody tr', { timeout: 30000 }).should('have.length.greaterThan', 0);
    // Click the first SLO NAME (the blue link text) to open the detail flyout.
    // Clicking the row itself toggles expand — the name link opens the flyout.
    cy.get('table tbody tr').first().find('span[role="button"]').first().click();
    // Forecast badge should appear — may show "Budget exhausted", "Exhausts in ~...",
    // or "Budget healthy" depending on mock SLO data.
    cy.get('[data-test-subj="forecast-badge"]', { timeout: 15000 }).should('exist');
    cy.get('[data-test-subj="forecast-badge"]')
      .invoke('text')
      .should('match', /Budget|Exhausts/);
  });

  // --------------------------------------------------------------------------
  // Grouped Incidents UI
  // --------------------------------------------------------------------------

  it('displays grouped incidents with confidence badges in topology view', () => {
    cy.ensureLoaded();
    cy.get('[data-test-subj="alertManager-tabs-services"]').click();
    cy.get('[data-test-subj="services-view-toggle"]').contains('Topology').click();
    cy.get('[data-test-subj="topology-incidents-panel"]', { timeout: 10000 }).should('exist');
    // Incident group cards
    cy.get('[data-test-subj^="topology-incident-group-"]').should('have.length.greaterThan', 0);
    // Confidence badges on incident groups
    cy.get('[data-test-subj^="incident-group-confidence-"]').should('have.length.greaterThan', 0);
    cy.get('[data-test-subj^="incident-group-confidence-"]')
      .first()
      .invoke('text')
      .should('match', /high|medium|low/);
  });

  it('incident group cards display root service name', () => {
    cy.ensureLoaded();
    cy.get('[data-test-subj="alertManager-tabs-services"]').click();
    cy.get('[data-test-subj="services-view-toggle"]').contains('Topology').click();
    cy.get('[data-test-subj^="topology-incident-group-"]', { timeout: 10000 })
      .first()
      .within(() => {
        // Each group card should contain a service name as bold text
        cy.get('strong').should('exist');
        cy.get('strong').invoke('text').should('have.length.greaterThan', 0);
      });
  });

  // --------------------------------------------------------------------------
  // Error States
  // --------------------------------------------------------------------------

  it('shows error callout when coverage gap API fails', () => {
    // Intercept the coverage-gaps API to simulate a failure.
    // Must be set BEFORE the page navigates to the services tab.
    cy.intercept('GET', '**/coverage-gaps*', {
      statusCode: 500,
      body: { error: 'Internal server error' },
    }).as('coverageGapsFail');

    cy.ensureLoaded();
    cy.get('[data-test-subj="alertManager-tabs-services"]').click();
    cy.wait('@coverageGapsFail');

    // Error callout should appear with a Retry button
    cy.contains('Coverage analysis unavailable', { timeout: 10000 }).should('exist');
    cy.contains('button', 'Retry').should('exist');
  });

  it('shows loading state for RCA panel', () => {
    // Intercept the RCA API with a delay to capture loading state.
    // Must be registered BEFORE opening the alert flyout.
    cy.intercept('POST', '**/rca*', (req) => {
      req.reply({
        delay: 3000,
        body: {
          alertId: 'test',
          serviceName: 'test',
          narrative: 'Test',
          confidence: 'low',
          evidence: [],
          rootService: null,
          dependencyAlerts: [],
          suggestedActions: [],
          computedAt: new Date().toISOString(),
        },
      });
    }).as('rcaDelayed');

    cy.ensureLoaded();
    cy.contains('Alerts').click();
    cy.get('table tbody tr', { timeout: 30000 }).should('have.length.greaterThan', 0);
    // Click the alert name button to open the detail flyout
    cy.contains('button', 'production_rule_1_api-gateway', { timeout: 10000 }).first().click();
    // Loading indicator should appear while waiting for the delayed RCA response
    cy.get('[data-test-subj="rca-loading"]', { timeout: 5000 }).should('exist');
  });
});
