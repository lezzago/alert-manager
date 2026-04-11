/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { handleGetAlertCorrelations } from '../correlation_handlers';
import type { AlertCorrelationService } from '../../../common/alert_correlation_service';
import type { UnifiedAlertSummary, Logger, AlertCorrelationResult } from '../../../common/types';

const logger: Logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

function makeAlert(overrides?: Partial<UnifiedAlertSummary>): UnifiedAlertSummary {
  return {
    id: 'alert-1',
    datasourceId: 'ds-1',
    datasourceType: 'prometheus',
    name: 'HighErrorRate',
    state: 'active',
    severity: 'critical',
    startTime: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    labels: { service: 'payment-service' },
    annotations: {},
    ...overrides,
  };
}

function makeCorrelationResult(
  overrides?: Partial<AlertCorrelationResult>
): AlertCorrelationResult {
  return {
    alertId: 'alert-1',
    serviceName: 'payment-service',
    timeWindow: { start: Date.now() - 900_000, end: Date.now() },
    traces: [],
    logs: [],
    metrics: [],
    failureModes: [],
    tracesSampled: false,
    ...overrides,
  };
}

describe('correlation_handlers', () => {
  describe('handleGetAlertCorrelations', () => {
    it('returns empty result when alert has no service label', async () => {
      const service = { getCorrelations: jest.fn() } as unknown as AlertCorrelationService;
      const alert = makeAlert({ labels: {} });

      const result = await handleGetAlertCorrelations(service, alert, undefined, undefined, logger);

      expect(result.status).toBe(200);
      expect(result.body).toHaveProperty('traces', []);
      expect(result.body).toHaveProperty('logs', []);
      expect(service.getCorrelations).not.toHaveBeenCalled();
    });

    it('returns correlation result on success', async () => {
      const correlationResult = makeCorrelationResult({
        traces: [
          {
            traceId: 'trace-1',
            spanId: 'span-1',
            serviceName: 'payment-service',
            operationName: 'POST /charge',
            statusCode: 2,
            durationMs: 2340,
            startTime: new Date().toISOString(),
            attributes: {},
          },
        ],
      });
      const service = {
        getCorrelations: jest.fn().mockResolvedValue(correlationResult),
      } as unknown as AlertCorrelationService;
      const alert = makeAlert();

      const result = await handleGetAlertCorrelations(service, alert, undefined, undefined, logger);

      expect(result.status).toBe(200);
      expect((result.body as AlertCorrelationResult).traces).toHaveLength(1);
    });

    it('returns empty result on service error', async () => {
      const service = {
        getCorrelations: jest.fn().mockRejectedValue(new Error('timeout')),
      } as unknown as AlertCorrelationService;
      const alert = makeAlert();

      const result = await handleGetAlertCorrelations(service, alert, undefined, undefined, logger);

      expect(result.status).toBe(200);
      expect(result.body).toHaveProperty('traces', []);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('passes sloQuery and datasourceId to service', async () => {
      const service = {
        getCorrelations: jest.fn().mockResolvedValue(makeCorrelationResult()),
      } as unknown as AlertCorrelationService;
      const alert = makeAlert();

      await handleGetAlertCorrelations(service, alert, 'rate(errors[5m])', 'ds-2', logger);

      expect(service.getCorrelations).toHaveBeenCalledWith(alert, 'rate(errors[5m])', 'ds-2');
    });
  });
});
