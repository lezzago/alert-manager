/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { AlertCorrelationService } from '../alert_correlation_service';
import type {
  AlertCorrelationProvider,
  CorrelatedTrace,
  CorrelatedLog,
  CorrelationTimeWindow,
  Logger,
  UnifiedAlertSummary,
} from '../types';

// ---------------------------------------------------------------------------
// Mock provider
// ---------------------------------------------------------------------------

function createMockProvider(
  overrides?: Partial<AlertCorrelationProvider>
): AlertCorrelationProvider {
  return {
    getCorrelatedTraces: jest.fn().mockResolvedValue([]),
    getCorrelatedLogs: jest.fn().mockResolvedValue([]),
    getCorrelatedMetrics: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
}

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
    startTime: new Date(Date.now() - 10 * 60_000).toISOString(), // 10 min ago
    lastUpdated: new Date().toISOString(),
    labels: { service: 'payment-service', severity: 'critical' },
    annotations: {},
    ...overrides,
  };
}

function makeTrace(overrides?: Partial<CorrelatedTrace>): CorrelatedTrace {
  return {
    traceId: 'trace-1',
    spanId: 'span-1',
    serviceName: 'payment-service',
    operationName: 'POST /api/charge',
    statusCode: 2,
    durationMs: 2340,
    startTime: new Date().toISOString(),
    attributes: {
      'exception.message': 'Connection refused to payment-db',
      'peer.service': 'postgres',
    },
    ...overrides,
  };
}

function makeLog(overrides?: Partial<CorrelatedLog>): CorrelatedLog {
  return {
    timestamp: new Date().toISOString(),
    serviceName: 'payment-service',
    severityText: 'ERROR',
    body: 'Connection refused to payment-db',
    attributes: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AlertCorrelationService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getCorrelations', () => {
    it('returns empty result when alert has no service label', async () => {
      const provider = createMockProvider();
      const service = new AlertCorrelationService(provider, logger);
      const alert = makeAlert({ labels: {} });

      const result = await service.getCorrelations(alert);

      expect(result.traces).toEqual([]);
      expect(result.logs).toEqual([]);
      expect(result.metrics).toEqual([]);
      expect(result.failureModes).toEqual([]);
      expect(provider.getCorrelatedTraces).not.toHaveBeenCalled();
    });

    it('fetches traces, logs, and metrics for alert with service label', async () => {
      const traces = [makeTrace()];
      const logs = [makeLog()];
      const provider = createMockProvider({
        getCorrelatedTraces: jest.fn().mockResolvedValue(traces),
        getCorrelatedLogs: jest.fn().mockResolvedValue(logs),
        getCorrelatedMetrics: jest.fn().mockResolvedValue([]),
      });
      const service = new AlertCorrelationService(provider, logger);
      const alert = makeAlert();

      const result = await service.getCorrelations(alert);

      expect(result.serviceName).toBe('payment-service');
      expect(result.traces).toHaveLength(1);
      expect(result.logs).toHaveLength(1);
      expect(provider.getCorrelatedTraces).toHaveBeenCalledTimes(1);
      expect(provider.getCorrelatedLogs).toHaveBeenCalledTimes(1);
    });

    it('expands time window by +/- 5 minutes', async () => {
      const provider = createMockProvider();
      const service = new AlertCorrelationService(provider, logger);
      const alertStart = Date.now() - 20 * 60_000; // 20 min ago
      const alertEnd = Date.now() - 10 * 60_000; // 10 min ago (resolved)
      const alert = makeAlert({
        startTime: new Date(alertStart).toISOString(),
        lastUpdated: new Date(alertEnd).toISOString(),
      });

      await service.getCorrelations(alert);

      const call = (provider.getCorrelatedTraces as jest.Mock).mock.calls[0];
      const window: CorrelationTimeWindow = call[1];
      // Window should be expanded by 5 min (300000ms) on each side
      expect(window.start).toBeLessThanOrEqual(alertStart - 5 * 60_000 + 1000);
      expect(window.end).toBeGreaterThanOrEqual(alertEnd + 5 * 60_000 - 1000);
    });

    it('caches results for same alert', async () => {
      const provider = createMockProvider({
        getCorrelatedTraces: jest.fn().mockResolvedValue([makeTrace()]),
      });
      const service = new AlertCorrelationService(provider, logger);
      const alert = makeAlert();

      await service.getCorrelations(alert);
      await service.getCorrelations(alert);

      // Only called once due to caching
      expect(provider.getCorrelatedTraces).toHaveBeenCalledTimes(1);
    });

    it('returns empty result on provider error', async () => {
      const provider = createMockProvider({
        getCorrelatedTraces: jest.fn().mockRejectedValue(new Error('timeout')),
        getCorrelatedLogs: jest.fn().mockRejectedValue(new Error('timeout')),
      });
      const service = new AlertCorrelationService(provider, logger);
      const alert = makeAlert();

      const result = await service.getCorrelations(alert);

      expect(result.traces).toEqual([]);
      expect(result.logs).toEqual([]);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('clears cache on clearCache()', async () => {
      const provider = createMockProvider({
        getCorrelatedTraces: jest.fn().mockResolvedValue([makeTrace()]),
      });
      const service = new AlertCorrelationService(provider, logger);
      const alert = makeAlert();

      await service.getCorrelations(alert);
      service.clearCache();
      await service.getCorrelations(alert);

      expect(provider.getCorrelatedTraces).toHaveBeenCalledTimes(2);
    });
  });

  describe('time window sampling for long-running alerts', () => {
    it('samples traces from 3 windows for alerts > 30 minutes', async () => {
      const provider = createMockProvider({
        getCorrelatedTraces: jest.fn().mockResolvedValue([makeTrace()]),
      });
      const service = new AlertCorrelationService(provider, logger);
      // Alert running for 2 hours
      const alert = makeAlert({
        startTime: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
        lastUpdated: new Date().toISOString(),
      });

      const result = await service.getCorrelations(alert);

      // Should call getCorrelatedTraces 3 times (start, middle, recent)
      expect(provider.getCorrelatedTraces).toHaveBeenCalledTimes(3);
      expect(result.tracesSampled).toBe(true);
    });

    it('does not sample for short alerts', async () => {
      const provider = createMockProvider({
        getCorrelatedTraces: jest.fn().mockResolvedValue([makeTrace()]),
      });
      const service = new AlertCorrelationService(provider, logger);
      // Alert running for 10 minutes
      const alert = makeAlert({
        startTime: new Date(Date.now() - 10 * 60_000).toISOString(),
        lastUpdated: new Date().toISOString(),
      });

      const result = await service.getCorrelations(alert);

      expect(provider.getCorrelatedTraces).toHaveBeenCalledTimes(1);
      expect(result.tracesSampled).toBe(false);
    });
  });

  describe('failure mode computation', () => {
    it('groups error traces by failure pattern', async () => {
      const traces = [
        makeTrace({
          attributes: {
            'exception.message': 'Connection refused to payment-db',
            'peer.service': 'postgres',
          },
        }),
        makeTrace({
          spanId: 'span-2',
          traceId: 'trace-2',
          attributes: {
            'exception.message': 'Connection refused to payment-db',
            'peer.service': 'postgres',
          },
        }),
        makeTrace({
          spanId: 'span-3',
          traceId: 'trace-3',
          attributes: {
            'exception.message': 'Timeout waiting for response',
            'peer.service': 'redis',
          },
        }),
      ];
      const provider = createMockProvider({
        getCorrelatedTraces: jest.fn().mockResolvedValue(traces),
      });
      const service = new AlertCorrelationService(provider, logger);
      const alert = makeAlert();

      const result = await service.getCorrelations(alert);

      expect(result.failureModes.length).toBeGreaterThanOrEqual(1);
      // Most common failure should be first
      expect(result.failureModes[0].count).toBe(2);
      expect(result.failureModes[0].percentage).toBe(67); // 2 out of 3
    });

    it('returns empty failure modes when no error traces', async () => {
      const traces = [makeTrace({ statusCode: 1 })]; // OK status
      const provider = createMockProvider({
        getCorrelatedTraces: jest.fn().mockResolvedValue(traces),
      });
      const service = new AlertCorrelationService(provider, logger);
      const alert = makeAlert();

      const result = await service.getCorrelations(alert);

      expect(result.failureModes).toEqual([]);
    });

    it('limits failure modes to top 5', async () => {
      const traces = Array.from({ length: 20 }, (_, i) =>
        makeTrace({
          spanId: `span-${i}`,
          traceId: `trace-${i}`,
          attributes: { 'exception.message': `Error type ${i % 7}` },
        })
      );
      const provider = createMockProvider({
        getCorrelatedTraces: jest.fn().mockResolvedValue(traces),
      });
      const service = new AlertCorrelationService(provider, logger);
      const alert = makeAlert();

      const result = await service.getCorrelations(alert);

      expect(result.failureModes.length).toBeLessThanOrEqual(5);
    });

    it('extracts failure pattern from operation name when no error attributes', async () => {
      const traces = [
        makeTrace({
          operationName: 'POST /api/charge',
          attributes: { 'peer.service': 'postgres' },
        }),
      ];
      const provider = createMockProvider({
        getCorrelatedTraces: jest.fn().mockResolvedValue(traces),
      });
      const service = new AlertCorrelationService(provider, logger);
      const alert = makeAlert();

      const result = await service.getCorrelations(alert);

      expect(result.failureModes[0].pattern).toBe('POST /api/charge to postgres');
    });
  });
});
