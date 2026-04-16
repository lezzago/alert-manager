/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { RootCauseAnalysisService } from '../root_cause_analysis_service';
import type { AlertCorrelationService } from '../alert_correlation_service';
import type { AlertCorrelationResult, UnifiedAlertSummary, EnrichedOtelService } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const noopLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

function makeAlert(overrides: Partial<UnifiedAlertSummary> = {}): UnifiedAlertSummary {
  return {
    id: 'alert-1',
    datasourceId: 'ds-1',
    datasourceType: 'prometheus',
    name: 'HighErrorRate',
    state: 'firing',
    severity: 'critical',
    message: 'Error rate is high',
    startTime: new Date(Date.now() - 300_000).toISOString(),
    lastUpdated: new Date().toISOString(),
    labels: { service: 'payment-service', severity: 'critical' },
    annotations: {},
    ...overrides,
  };
}

function makeCorrelationResult(
  overrides: Partial<AlertCorrelationResult> = {}
): AlertCorrelationResult {
  return {
    alertId: 'alert-1',
    serviceName: 'payment-service',
    timeWindow: {
      start: new Date(Date.now() - 600_000).toISOString(),
      end: new Date().toISOString(),
    },
    traces: [
      {
        traceId: 'trace-1',
        spanId: 'span-1',
        serviceName: 'payment-service',
        operationName: 'processPayment',
        statusCode: 2,
        durationMs: 5200,
        startTime: new Date().toISOString(),
        attributes: { 'exception.message': 'Connection refused to payment-db' },
      },
    ],
    logs: [
      {
        timestamp: new Date().toISOString(),
        serviceName: 'payment-service',
        severityText: 'ERROR',
        body: 'Failed to connect to database',
        attributes: {},
      },
    ],
    metrics: [],
    failureModes: [
      {
        pattern: 'Connection refused to payment-db',
        percentage: 78,
        count: 45,
        exampleTraceIds: ['trace-1', 'trace-2'],
      },
    ],
    tracesSampled: false,
    ...overrides,
  };
}

function makeService(overrides: Partial<EnrichedOtelService> = {}): EnrichedOtelService {
  return {
    name: 'payment-service',
    environment: 'production',
    type: 'Service',
    sdkLanguage: 'java',
    dependencies: ['postgres', 'notification-service'],
    lastSeen: new Date().toISOString(),
    sloCount: 2,
    activeAlertCount: 1,
    signals: { hasTraces: true, hasLogs: true, hasMetrics: true },
    ...overrides,
  };
}

function makeMockCorrelationService(
  resultOverrides?: Partial<AlertCorrelationResult>
): AlertCorrelationService {
  return {
    getCorrelations: jest.fn().mockResolvedValue(makeCorrelationResult(resultOverrides)),
    clearCache: jest.fn(),
  } as unknown as AlertCorrelationService;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RootCauseAnalysisService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns empty analysis for alerts without service label', async () => {
    const corrService = makeMockCorrelationService();
    const rca = new RootCauseAnalysisService(corrService, noopLogger);

    const alert = makeAlert({ labels: {} });
    const result = await rca.analyze(alert, []);

    expect(result.confidence).toBe('low');
    expect(result.narrative).toContain('does not have a service label');
    expect(corrService.getCorrelations).not.toHaveBeenCalled();
  });

  it('includes failure modes in narrative and evidence', async () => {
    const corrService = makeMockCorrelationService();
    const rca = new RootCauseAnalysisService(corrService, noopLogger);

    const services = [makeService()];
    const result = await rca.analyze(makeAlert(), services);

    expect(result.narrative).toContain('78%');
    expect(result.narrative).toContain('Connection refused to payment-db');
    expect(result.evidence.some((e) => e.type === 'failure_mode')).toBe(true);
  });

  it('identifies dependency as root when dependency has alerts', async () => {
    const corrService = makeMockCorrelationService();
    const rca = new RootCauseAnalysisService(corrService, noopLogger);

    const services = [
      makeService({ name: 'payment-service', dependencies: ['postgres'] }),
      makeService({ name: 'postgres', activeAlertCount: 3, dependencies: [] }),
    ];

    const result = await rca.analyze(makeAlert(), services);

    expect(result.rootService).toBe('postgres');
    expect(result.dependencyAlerts).toHaveLength(1);
    expect(result.dependencyAlerts[0].serviceName).toBe('postgres');
    expect(result.narrative).toContain('postgres');
    expect(result.narrative).toContain('root cause');
  });

  it('sets confidence to high with strong signals', async () => {
    const corrService = makeMockCorrelationService();
    const rca = new RootCauseAnalysisService(corrService, noopLogger);

    const services = [
      makeService({ name: 'payment-service', dependencies: ['postgres'] }),
      makeService({ name: 'postgres', activeAlertCount: 2, dependencies: [] }),
    ];

    const result = await rca.analyze(makeAlert(), services);
    // Has failure modes, alerting deps, dep correlations, and traces → high
    expect(result.confidence).toBe('high');
  });

  it('includes suggested actions', async () => {
    const corrService = makeMockCorrelationService();
    const rca = new RootCauseAnalysisService(corrService, noopLogger);

    const services = [makeService()];
    const result = await rca.analyze(makeAlert(), services);

    expect(result.suggestedActions.length).toBeGreaterThan(0);
    expect(result.suggestedActions.some((a) => a.includes('pattern'))).toBe(true);
  });

  it('caches results for the same alert', async () => {
    const corrService = makeMockCorrelationService();
    const rca = new RootCauseAnalysisService(corrService, noopLogger);

    const alert = makeAlert();
    const services = [makeService()];

    await rca.analyze(alert, services);
    await rca.analyze(alert, services);

    // Should only call correlation service once due to cache
    expect(corrService.getCorrelations).toHaveBeenCalledTimes(1);
  });

  it('handles correlation service errors gracefully', async () => {
    const corrService = {
      getCorrelations: jest.fn().mockRejectedValue(new Error('timeout')),
      clearCache: jest.fn(),
    } as unknown as AlertCorrelationService;
    const rca = new RootCauseAnalysisService(corrService, noopLogger);

    const result = await rca.analyze(makeAlert(), [makeService()]);

    expect(result.confidence).toBe('low');
    expect(result.narrative).toContain('Insufficient data');
  });
});
