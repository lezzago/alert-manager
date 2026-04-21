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

  // ----- Sparkline columns -----

  it('shows Alert Trend and Budget Trend columns', () => {
    cy.get('[data-test-subj="alertManager-tabs-services"]').click();
    cy.contains('Alert Trend').should('exist');
    cy.contains('Budget Trend').should('exist');
  });

  it('renders sparkline charts in table rows', () => {
    cy.get('[data-test-subj="alertManager-tabs-services"]').click();
    // ECharts sparklines render as canvas/div elements with data-test-subj
    cy.get('[data-test-subj="metric-sparkline"]').should('have.length.greaterThan', 0);
  });

  // ----- Filter sidebar -----

  it('shows filter sidebar with accordion groups', () => {
    cy.get('[data-test-subj="alertManager-tabs-services"]').click();
    cy.get('[data-test-subj="services-filter-sidebar"]').should('exist');
    cy.get('[data-test-subj="filter-health-accordion"]').should('exist');
    cy.get('[data-test-subj="filter-signal-accordion"]').should('exist');
    cy.get('[data-test-subj="filter-slos-accordion"]').should('exist');
  });

  it('filters services by health level', () => {
    cy.get('[data-test-subj="alertManager-tabs-services"]').click();
    // EUI checkboxes have visually-hidden <input> — force: true required
    cy.get('[data-test-subj="filter-health-healthy"]').click({ force: true });
    cy.get('[data-test-subj="active-filter-badges"]').should('exist');
    cy.get('[data-test-subj="filter-badge-health-healthy"]').should('exist');
    cy.get('[data-test-subj="services-table"] tbody tr').should('have.length.greaterThan', 0);
  });

  it('filters services by signal type', () => {
    cy.get('[data-test-subj="alertManager-tabs-services"]').click();
    cy.get('[data-test-subj="filter-signal-traces"]').click({ force: true });
    cy.get('[data-test-subj="active-filter-badges"]').should('exist');
    cy.get('[data-test-subj="filter-badge-signal-traces"]').should('exist');
  });

  it('filters services by SLO presence', () => {
    cy.get('[data-test-subj="alertManager-tabs-services"]').click();
    cy.get('[data-test-subj="filter-slo-yes"]').click({ force: true });
    cy.get('[data-test-subj="active-filter-badges"]').should('exist');
    cy.get('[data-test-subj="filter-badge-hasSlos-yes"]').should('exist');
  });

  it('clears all filters with Clear all badge', () => {
    cy.get('[data-test-subj="alertManager-tabs-services"]').click();
    cy.get('[data-test-subj="filter-health-critical"]').click({ force: true });
    cy.get('[data-test-subj="active-filter-badges"]').should('exist');
    cy.get('[data-test-subj="filter-clear-all"]').click();
    cy.get('[data-test-subj="active-filter-badges"]').should('not.exist');
  });

  it('shows resizable container with sidebar and table panels', () => {
    cy.get('[data-test-subj="alertManager-tabs-services"]').click();
    cy.get('[data-test-subj="services-resizable"]').should('exist');
  });
});
