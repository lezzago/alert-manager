/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

describe('Services Tab', () => {
  beforeEach(() => {
    cy.ensureLoaded();
  });

  it('navigates to the Services tab', () => {
    cy.get('[data-test-subj="alertManager-tabs-services"]').click();
    cy.get('[data-test-subj="services-stat-cards"]').should('exist');
  });

  it('displays stat cards with service counts', () => {
    cy.get('[data-test-subj="alertManager-tabs-services"]').click();
    cy.contains('Total Services').should('exist');
    cy.contains('With SLOs').should('exist');
    cy.contains('Without SLOs').should('exist');
    cy.contains('With Active Alerts').should('exist');
  });

  it('shows services table with mock data', () => {
    cy.get('[data-test-subj="alertManager-tabs-services"]').click();
    cy.get('[data-test-subj="services-table"]').should('exist');
    // Mock OTEL provider returns 8 services
    cy.get('[data-test-subj="services-table"] tbody tr').should('have.length.greaterThan', 0);
  });

  it('displays known mock services', () => {
    cy.get('[data-test-subj="alertManager-tabs-services"]').click();
    cy.get('[data-test-subj="service-name-api-gateway"]').should('exist');
    cy.get('[data-test-subj="service-name-payment-service"]').should('exist');
  });

  it('shows signal badges (T/L/M) for services', () => {
    cy.get('[data-test-subj="alertManager-tabs-services"]').click();
    // Services should show Traces, Logs, Metrics badges
    cy.contains('T').should('exist');
    cy.contains('L').should('exist');
    cy.contains('M').should('exist');
  });

  it('opens service detail flyout on row click', () => {
    cy.get('[data-test-subj="alertManager-tabs-services"]').click();
    cy.get('[data-test-subj="service-name-api-gateway"]').click();
    cy.get('[data-test-subj="service-detail-flyout"]').should('exist');
    cy.contains('api-gateway').should('exist');
    cy.contains('production').should('exist');
  });

  it('shows dependencies in flyout', () => {
    cy.get('[data-test-subj="alertManager-tabs-services"]').click();
    cy.get('[data-test-subj="service-name-api-gateway"]').click();
    cy.get('[data-test-subj="service-detail-flyout"]').within(() => {
      cy.contains('Dependencies').should('exist');
      cy.contains('payment-service').should('exist');
    });
  });

  it('shows signal badges in flyout', () => {
    cy.get('[data-test-subj="alertManager-tabs-services"]').click();
    cy.get('[data-test-subj="service-name-api-gateway"]').click();
    cy.get('[data-test-subj="service-detail-flyout"]').within(() => {
      cy.get('[data-test-subj="service-signal-Traces"]').should('exist');
      cy.get('[data-test-subj="service-signal-Logs"]').should('exist');
      cy.get('[data-test-subj="service-signal-Metrics"]').should('exist');
    });
  });

  it('closes flyout when close button is clicked', () => {
    cy.get('[data-test-subj="alertManager-tabs-services"]').click();
    cy.get('[data-test-subj="service-name-api-gateway"]').click();
    cy.get('[data-test-subj="service-detail-flyout"]').should('exist');
    cy.get('[data-test-subj="service-detail-flyout"]').contains('Close').click();
    cy.get('[data-test-subj="service-detail-flyout"]').should('not.exist');
  });

  it('filters services by search', () => {
    cy.get('[data-test-subj="alertManager-tabs-services"]').click();
    cy.get('[data-test-subj="services-search"]').type('payment');
    cy.get('[data-test-subj="services-table"] tbody tr').should('have.length', 1);
    cy.get('[data-test-subj="service-name-payment-service"]').should('exist');
  });

  it('shows SLO Coverage column in table', () => {
    cy.get('[data-test-subj="alertManager-tabs-services"]').click();
    cy.contains('SLO Coverage').should('exist');
  });

  it('flyout shows Suggested SLOs panel', () => {
    cy.get('[data-test-subj="alertManager-tabs-services"]').click();
    cy.get('[data-test-subj="service-name-api-gateway"]').click();
    cy.get('[data-test-subj="suggested-slos-panel"]').should('exist');
  });
});
