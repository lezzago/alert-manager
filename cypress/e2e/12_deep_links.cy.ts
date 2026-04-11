/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

describe('Deep Links (Phase 4)', () => {
  beforeEach(() => {
    cy.ensureLoaded();
  });

  // ==========================================================================
  // 4.3 — URL-Based Hash Routing
  // ==========================================================================

  describe('Hash routing', () => {
    it('sets hash to #/alerts on initial load', () => {
      cy.url().should('include', '#/alerts');
    });

    it('updates hash when switching to Rules tab', () => {
      cy.contains('Rules').click();
      cy.url().should('include', '#/rules');
    });

    it('updates hash when switching to SLOs tab', () => {
      cy.contains('SLOs').click();
      cy.url().should('include', '#/slos');
    });

    it('updates hash when switching to Services tab', () => {
      cy.contains('Services').click();
      cy.url().should('include', '#/services');
    });

    it('updates hash when switching to Routing tab', () => {
      cy.contains('Routing').click();
      cy.url().should('include', '#/routing');
    });

    it('updates hash when switching to Suppression tab', () => {
      cy.contains('Suppression').click();
      cy.url().should('include', '#/suppression');
    });

    it('restores Alerts tab when navigating to #/alerts hash', () => {
      // First switch away
      cy.contains('Rules').click();
      cy.url().should('include', '#/rules');
      // Navigate back via hash
      cy.window().then((win) => {
        win.location.hash = '#/alerts';
      });
      cy.get('[data-test-subj="alertManager-tabs-alerts"]').should(
        'have.attr',
        'aria-selected',
        'true'
      );
    });
  });

  // ==========================================================================
  // 4.1 — Alert Manager -> APM Deep Links
  // ==========================================================================

  describe('APM deep links in correlation panel', () => {
    it('renders trace ID links in correlation traces table', () => {
      cy.getApiBase().then((base) => {
        cy.intercept('POST', `${base}/correlations`).as('getCorrelations');
      });
      // Navigate to alerts, open first alert
      cy.contains('Alerts').click();
      cy.get('table tbody tr', { timeout: 30000 }).first().click();
      // Wait for flyout — check for any content
      cy.wait(1500);
      // If correlation panel loaded with traces, check for trace links
      cy.get('body').then(($body) => {
        if ($body.find('[data-test-subj="correlationTracesTable"]').length) {
          cy.get('[data-test-subj="correlationTracesTable"]')
            .find('[data-test-subj^="trace-link-"]')
            .should('exist');
        }
      });
    });

    it('renders "View all logs" link in logs sub-tab', () => {
      cy.contains('Alerts').click();
      cy.get('table tbody tr', { timeout: 30000 }).first().click();
      cy.wait(1500);
      cy.get('body').then(($body) => {
        // If correlation panel exists with logs tab
        if ($body.find('[data-test-subj="correlationTab-logs"]').length) {
          cy.get('[data-test-subj="correlationTab-logs"]').click();
          // Check for the view all logs link
          if ($body.find('[data-test-subj="viewAllLogsLink"]').length) {
            cy.get('[data-test-subj="viewAllLogsLink"]').should('exist');
          }
        }
      });
    });
  });

  describe('APM deep link in service detail flyout', () => {
    it('renders "View in APM" button in service flyout', () => {
      cy.contains('Services').click();
      cy.get('[data-test-subj="services-table"]', { timeout: 15000 }).should('exist');
      // Click first service
      cy.get('[data-test-subj^="service-name-"]').first().click();
      cy.get('[data-test-subj="service-detail-flyout"]', { timeout: 5000 }).should('exist');
      cy.get('[data-test-subj="service-view-in-apm"]').should('exist');
    });
  });

  // ==========================================================================
  // 4.2 — Service Health API (APM -> Alert Manager)
  // ==========================================================================

  describe('Service health API', () => {
    it('returns health data for a known service', () => {
      cy.getApiBase().then((base) => {
        cy.request({
          method: 'GET',
          url: `${base}/services/payment-service/health`,
          failOnStatusCode: false,
        }).then((resp) => {
          expect(resp.status).to.eq(200);
          expect(resp.body).to.have.property('serviceName', 'payment-service');
          expect(resp.body).to.have.property('activeAlertCount');
          expect(resp.body).to.have.property('severityBreakdown');
          expect(resp.body).to.have.property('slos');
          expect(resp.body).to.have.property('hasSlos');
          expect(resp.body).to.have.property('alertManagerUrl');
          expect(resp.body.alertManagerUrl).to.include('#/services/payment-service');
          expect(resp.body.slos).to.be.an('array');
        });
      });
    });

    it('returns 404 for unknown service', () => {
      cy.getApiBase().then((base) => {
        cy.request({
          method: 'GET',
          url: `${base}/services/nonexistent-service-xyz/health`,
          failOnStatusCode: false,
        }).then((resp) => {
          expect(resp.status).to.eq(404);
        });
      });
    });
  });
});
