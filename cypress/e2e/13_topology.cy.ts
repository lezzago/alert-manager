/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

describe('Service Health Dashboard (Topology)', () => {
  beforeEach(() => {
    cy.ensureLoaded();
    cy.get('[data-test-subj="alertManager-tabs-services"]').click();
  });

  it('shows view toggle with List and Topology options', () => {
    cy.get('[data-test-subj="services-view-toggle"]').should('exist');
    cy.get('[data-test-subj="services-view-toggle"]').contains('List').should('exist');
    cy.get('[data-test-subj="services-view-toggle"]').contains('Topology').should('exist');
  });

  it('defaults to list view', () => {
    cy.get('[data-test-subj="services-table"]').should('exist');
    cy.get('[data-test-subj="service-health-dashboard"]').should('not.exist');
  });

  it('switches to topology view', () => {
    cy.get('[data-test-subj="services-view-toggle"]').contains('Topology').click();
    cy.get('[data-test-subj="service-health-dashboard"]').should('exist');
    cy.get('[data-test-subj="services-table"]').should('not.exist');
  });

  it('displays topology graph', () => {
    cy.get('[data-test-subj="services-view-toggle"]').contains('Topology').click();
    cy.get('[data-test-subj="topology-graph"]').should('exist');
  });

  it('displays service list in left panel', () => {
    cy.get('[data-test-subj="services-view-toggle"]').contains('Topology').click();
    cy.get('[data-test-subj="topology-service-item-api-gateway"]').should('exist');
    cy.get('[data-test-subj="topology-service-item-payment-service"]').should('exist');
  });

  it('displays incidents panel', () => {
    cy.get('[data-test-subj="services-view-toggle"]').contains('Topology').click();
    cy.get('[data-test-subj="topology-incidents-panel"]').should('exist');
    cy.contains('Active Incidents').should('exist');
  });

  it('shows active incidents for services with alerts', () => {
    cy.get('[data-test-subj="services-view-toggle"]').contains('Topology').click();
    // Mock data has services with active alerts
    cy.get('[data-test-subj="topology-incidents-panel"]').within(() => {
      cy.get('[data-test-subj^="topology-incident-"]').should('have.length.greaterThan', 0);
    });
  });

  it('shows health legend in topology view', () => {
    cy.get('[data-test-subj="services-view-toggle"]').contains('Topology').click();
    cy.contains('Healthy').should('exist');
    cy.contains('Degraded').should('exist');
    cy.contains('Critical').should('exist');
  });

  it('opens service detail flyout from topology service list', () => {
    cy.get('[data-test-subj="services-view-toggle"]').contains('Topology').click();
    cy.get('[data-test-subj="topology-service-item-api-gateway"]').click();
    cy.get('[data-test-subj="service-detail-flyout"]').should('exist');
    cy.contains('api-gateway').should('exist');
  });

  it('shows blast radius in incident cards', () => {
    cy.get('[data-test-subj="services-view-toggle"]').contains('Topology').click();
    cy.get('[data-test-subj="topology-incidents-panel"]').within(() => {
      cy.contains('Blast radius').should('exist');
    });
  });

  it('has service search filter in topology view', () => {
    cy.get('[data-test-subj="services-view-toggle"]').contains('Topology').click();
    cy.get('[data-test-subj="topology-service-search"]').should('exist');
  });

  it('switches back to list view', () => {
    cy.get('[data-test-subj="services-view-toggle"]').contains('Topology').click();
    cy.get('[data-test-subj="service-health-dashboard"]').should('exist');
    cy.get('[data-test-subj="services-view-toggle"]').contains('List').click();
    cy.get('[data-test-subj="services-table"]').should('exist');
    cy.get('[data-test-subj="service-health-dashboard"]').should('not.exist');
  });

  it('preserves stat cards in both views', () => {
    // Stat cards should be visible in list view
    cy.get('[data-test-subj="services-stat-cards"]').should('exist');
    // Switch to topology
    cy.get('[data-test-subj="services-view-toggle"]').contains('Topology').click();
    // Stat cards should still be visible
    cy.get('[data-test-subj="services-stat-cards"]').should('exist');
  });
});
