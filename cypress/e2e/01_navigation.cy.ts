/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

describe('Navigation', () => {
  beforeEach(() => {
    cy.ensureLoaded();
  });

  it('loads the main page with all 6 tabs visible', () => {
    cy.contains('Alert Manager').should('be.visible');
    cy.contains('Alerts').should('be.visible');
    cy.contains('Rules').should('be.visible');
    cy.contains('Routing').should('be.visible');
    cy.contains('Suppression').should('be.visible');
    cy.contains('SLOs').should('be.visible');
    cy.contains('Services').should('be.visible');
  });

  it('switches to Rules tab', () => {
    cy.contains('Rules').click();
    cy.url().should('include', '/');
  });

  it('switches to SLOs tab', () => {
    cy.contains('SLOs').click();
    cy.url().should('include', '/');
  });
});
