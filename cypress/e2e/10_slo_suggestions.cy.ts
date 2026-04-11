/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

describe('SLO Suggestions', () => {
  beforeEach(() => {
    cy.ensureLoaded();
    cy.get('[data-test-subj="alertManager-tabs-services"]').click();
  });

  // --------------------------------------------------------------------------
  // Services Table — SLO Coverage column
  // --------------------------------------------------------------------------

  it('shows SLO Coverage column in services table', () => {
    cy.get('[data-test-subj="services-table"]').should('exist');
    cy.contains('SLO Coverage').should('exist');
  });

  it('displays coverage badges for services with detectable metrics', () => {
    // Mock data includes http_requests_total + http_request_duration_seconds_bucket
    // which match all mock services, so badges should render
    cy.get('[data-test-subj^="service-slo-coverage-"]').should('have.length.greaterThan', 0);
  });

  it('coverage badge shows "X of Y suggested" format', () => {
    cy.get('[data-test-subj^="service-slo-coverage-"]')
      .first()
      .invoke('text')
      .should('match', /\d+ of \d+ suggested/);
  });

  // --------------------------------------------------------------------------
  // Flyout — Suggested SLOs panel
  // --------------------------------------------------------------------------

  it('flyout shows Suggested SLOs panel', () => {
    cy.get('[data-test-subj="service-name-api-gateway"]').click();
    cy.get('[data-test-subj="service-detail-flyout"]').should('exist');
    cy.get('[data-test-subj="suggested-slos-panel"]').should('exist');
    cy.contains('Suggested SLOs').should('exist');
  });

  it('suggestion cards display template name and confidence', () => {
    cy.get('[data-test-subj="service-name-api-gateway"]').click();
    cy.get('[data-test-subj="suggested-slos-panel"]').within(() => {
      // Should have at least one suggestion card
      cy.get('[data-test-subj^="suggestion-card-"]').should('have.length.greaterThan', 0);
      // First suggestion should show confidence badge
      cy.get('[data-test-subj^="suggestion-confidence-"]').first().should('exist');
    });
  });

  it('suggestion cards have Create button for uncovered SLOs', () => {
    cy.get('[data-test-subj="service-name-api-gateway"]').click();
    cy.get('[data-test-subj="suggested-slos-panel"]').within(() => {
      cy.get('[data-test-subj^="suggestion-create-"]').should('have.length.greaterThan', 0);
    });
  });

  it('shows suggestion reason text', () => {
    cy.get('[data-test-subj="service-name-api-gateway"]').click();
    cy.get('[data-test-subj="suggested-slos-panel"]').within(() => {
      cy.contains('Detected').should('exist');
    });
  });

  // --------------------------------------------------------------------------
  // Wizard pre-fill from suggestion
  // --------------------------------------------------------------------------

  it('clicking Create opens wizard with pre-filled data', () => {
    cy.get('[data-test-subj="service-name-api-gateway"]').click();
    cy.get('[data-test-subj="suggested-slos-panel"]').within(() => {
      cy.get('[data-test-subj^="suggestion-create-"]').first().click();
    });

    // Wizard should open — look for the SLO creation title
    cy.contains('Create Service Level Objective').should('exist');

    // Generated rules should show pre-filled name containing api-gateway
    cy.contains('api-gateway').should('exist');
  });

  it('wizard has pre-filled SLO name from suggestion', () => {
    cy.get('[data-test-subj="service-name-api-gateway"]').click();
    cy.get('[data-test-subj="suggested-slos-panel"]').within(() => {
      cy.get('[data-test-subj^="suggestion-create-"]').first().click();
    });

    // SLO name field should contain service name
    cy.get('input[aria-label="SLO name"]').invoke('val').should('contain', 'api-gateway');
  });

  it('closing wizard returns to services tab', () => {
    cy.get('[data-test-subj="service-name-api-gateway"]').click();
    cy.get('[data-test-subj="suggested-slos-panel"]').within(() => {
      cy.get('[data-test-subj^="suggestion-create-"]').first().click();
    });

    // Close the wizard
    cy.contains('Cancel').click();

    // Should be back on services tab
    cy.get('[data-test-subj="services-table"]').should('exist');
  });
});
