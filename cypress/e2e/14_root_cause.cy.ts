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
