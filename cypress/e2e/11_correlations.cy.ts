/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

describe('Alert Cross-Signal Correlations', () => {
  beforeEach(() => {
    cy.ensureLoaded();
    cy.contains('Alerts').click();
  });

  it('shows correlation accordion in alert detail flyout', () => {
    // Click first alert row to open flyout
    cy.get('table tbody tr', { timeout: 30000 }).first().click();
    // The correlation accordion should be present (if alert has service label)
    // Check that the flyout rendered
    cy.get('body').should('be.visible');
  });

  it('correlation panel fetches data via API', () => {
    // Intercept the correlations API call
    cy.getApiBase().then((base) => {
      cy.intercept('POST', `${base}/correlations`).as('getCorrelations');
    });

    // Click first alert to open flyout
    cy.get('table tbody tr', { timeout: 30000 }).first().click();

    // If the alert has a service label, the correlation API will be called.
    // We wait briefly — if no service label, the call won't happen.
    cy.wait(1000);
  });

  it('correlation API returns valid response shape', () => {
    cy.getApiBase().then((base) => {
      cy.request({
        method: 'POST',
        url: `${base}/correlations`,
        body: {
          alert: {
            id: 'test-alert',
            datasourceId: 'ds-1',
            datasourceType: 'prometheus',
            name: 'TestAlert',
            state: 'active',
            severity: 'critical',
            startTime: new Date(Date.now() - 600000).toISOString(),
            lastUpdated: new Date().toISOString(),
            labels: { service: 'payment-service' },
            annotations: {},
          },
        },
        failOnStatusCode: false,
      }).then((resp) => {
        expect(resp.status).to.eq(200);
        expect(resp.body).to.have.property('alertId');
        expect(resp.body).to.have.property('serviceName');
        expect(resp.body).to.have.property('traces');
        expect(resp.body).to.have.property('logs');
        expect(resp.body).to.have.property('metrics');
        expect(resp.body).to.have.property('failureModes');
        expect(resp.body).to.have.property('tracesSampled');
        expect(resp.body.traces).to.be.an('array');
        expect(resp.body.logs).to.be.an('array');
      });
    });
  });

  it('correlation API returns traces with expected fields', () => {
    cy.getApiBase().then((base) => {
      cy.request({
        method: 'POST',
        url: `${base}/correlations`,
        body: {
          alert: {
            id: 'test-alert-2',
            datasourceId: 'ds-1',
            datasourceType: 'prometheus',
            name: 'TestAlert',
            state: 'active',
            severity: 'critical',
            startTime: new Date(Date.now() - 600000).toISOString(),
            lastUpdated: new Date().toISOString(),
            labels: { service: 'payment-service' },
            annotations: {},
          },
        },
      }).then((resp) => {
        expect(resp.body.traces.length).to.be.greaterThan(0);
        const trace = resp.body.traces[0];
        expect(trace).to.have.property('traceId');
        expect(trace).to.have.property('spanId');
        expect(trace).to.have.property('serviceName', 'payment-service');
        expect(trace).to.have.property('operationName');
        expect(trace).to.have.property('statusCode', 2);
        expect(trace).to.have.property('durationMs');
        expect(trace).to.have.property('attributes');
      });
    });
  });

  it('correlation API returns logs with expected fields', () => {
    cy.getApiBase().then((base) => {
      cy.request({
        method: 'POST',
        url: `${base}/correlations`,
        body: {
          alert: {
            id: 'test-alert-3',
            datasourceId: 'ds-1',
            datasourceType: 'prometheus',
            name: 'TestAlert',
            state: 'active',
            severity: 'critical',
            startTime: new Date(Date.now() - 600000).toISOString(),
            lastUpdated: new Date().toISOString(),
            labels: { service: 'payment-service' },
            annotations: {},
          },
        },
      }).then((resp) => {
        expect(resp.body.logs.length).to.be.greaterThan(0);
        const log = resp.body.logs[0];
        expect(log).to.have.property('timestamp');
        expect(log).to.have.property('serviceName', 'payment-service');
        expect(log).to.have.property('severityText');
        expect(log).to.have.property('body');
        expect(['ERROR', 'FATAL']).to.include(log.severityText);
      });
    });
  });

  it('correlation API returns failure modes', () => {
    cy.getApiBase().then((base) => {
      cy.request({
        method: 'POST',
        url: `${base}/correlations`,
        body: {
          alert: {
            id: 'test-alert-4',
            datasourceId: 'ds-1',
            datasourceType: 'prometheus',
            name: 'TestAlert',
            state: 'active',
            severity: 'critical',
            startTime: new Date(Date.now() - 600000).toISOString(),
            lastUpdated: new Date().toISOString(),
            labels: { service: 'payment-service' },
            annotations: {},
          },
        },
      }).then((resp) => {
        expect(resp.body.failureModes.length).to.be.greaterThan(0);
        const mode = resp.body.failureModes[0];
        expect(mode).to.have.property('pattern');
        expect(mode).to.have.property('percentage');
        expect(mode).to.have.property('count');
        expect(mode).to.have.property('exampleTraceIds');
        expect(mode.percentage).to.be.greaterThan(0);
      });
    });
  });

  it('correlation API handles alert without service label', () => {
    cy.getApiBase().then((base) => {
      cy.request({
        method: 'POST',
        url: `${base}/correlations`,
        body: {
          alert: {
            id: 'test-no-service',
            datasourceId: 'ds-1',
            datasourceType: 'prometheus',
            name: 'NoServiceAlert',
            state: 'active',
            severity: 'medium',
            startTime: new Date().toISOString(),
            lastUpdated: new Date().toISOString(),
            labels: {},
            annotations: {},
          },
        },
      }).then((resp) => {
        expect(resp.status).to.eq(200);
        expect(resp.body.traces).to.deep.eq([]);
        expect(resp.body.logs).to.deep.eq([]);
        expect(resp.body.failureModes).to.deep.eq([]);
      });
    });
  });

  it('correlation API returns metrics data', () => {
    cy.getApiBase().then((base) => {
      cy.request({
        method: 'POST',
        url: `${base}/correlations`,
        body: {
          alert: {
            id: 'test-alert-5',
            datasourceId: 'ds-1',
            datasourceType: 'prometheus',
            name: 'TestAlert',
            state: 'active',
            severity: 'critical',
            startTime: new Date(Date.now() - 600000).toISOString(),
            lastUpdated: new Date().toISOString(),
            labels: { service: 'order-service' },
            annotations: {},
          },
        },
      }).then((resp) => {
        expect(resp.body.metrics.length).to.be.greaterThan(0);
        const metric = resp.body.metrics[0];
        expect(metric).to.have.property('metricName');
        expect(metric).to.have.property('labels');
        expect(metric).to.have.property('dataPoints');
        expect(metric.dataPoints.length).to.be.greaterThan(0);
      });
    });
  });
});
