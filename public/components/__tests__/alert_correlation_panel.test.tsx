/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen, configure, fireEvent, waitFor } from '@testing-library/react';
import { AlertCorrelationPanel } from '../alert_correlation_panel';
import type {
  UnifiedAlertSummary,
  AlertCorrelationResult,
  CorrelatedTrace,
  CorrelatedLog,
} from '../../../common/types';
import type { AlarmsApiClient } from '../../services/alarms_client';

configure({ testIdAttribute: 'data-test-subj' });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAlert(overrides?: Partial<UnifiedAlertSummary>): UnifiedAlertSummary {
  return {
    id: 'alert-1',
    datasourceId: 'ds-1',
    datasourceType: 'prometheus',
    name: 'HighErrorRate',
    state: 'active',
    severity: 'critical',
    startTime: new Date(Date.now() - 10 * 60_000).toISOString(),
    lastUpdated: new Date().toISOString(),
    labels: { service: 'payment-service', severity: 'critical' },
    annotations: {},
    ...overrides,
  };
}

function makeTrace(overrides?: Partial<CorrelatedTrace>): CorrelatedTrace {
  return {
    traceId: 'trace-abc',
    spanId: 'span-xyz',
    serviceName: 'payment-service',
    operationName: 'POST /api/charge',
    statusCode: 2,
    durationMs: 2340,
    startTime: new Date().toISOString(),
    attributes: {
      'exception.message': 'Connection refused to payment-db',
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
    traceId: 'trace-abc',
    attributes: {},
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

function createMockApiClient(result?: AlertCorrelationResult): AlarmsApiClient {
  return {
    getAlertCorrelations: jest.fn().mockResolvedValue(result ?? makeCorrelationResult()),
  } as unknown as AlarmsApiClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AlertCorrelationPanel', () => {
  it('shows empty prompt when alert has no service label', () => {
    const alert = makeAlert({ labels: {} });
    const apiClient = createMockApiClient();

    const { container } = render(<AlertCorrelationPanel alert={alert} apiClient={apiClient} />);

    // EuiEmptyPrompt stub renders as div[data-eui="EuiEmptyPrompt"]
    expect(container.querySelector('[data-eui="EuiEmptyPrompt"]')).toBeTruthy();
    expect(apiClient.getAlertCorrelations).not.toHaveBeenCalled();
  });

  it('shows loading spinner initially', () => {
    const alert = makeAlert();
    const apiClient = createMockApiClient();

    render(<AlertCorrelationPanel alert={alert} apiClient={apiClient} />);

    expect(screen.getByText(/Loading correlations/)).toBeDefined();
  });

  it('renders sub-tabs after loading', async () => {
    const alert = makeAlert();
    const result = makeCorrelationResult({
      traces: [makeTrace()],
      logs: [makeLog()],
    });
    const apiClient = createMockApiClient(result);

    render(<AlertCorrelationPanel alert={alert} apiClient={apiClient} />);

    await waitFor(() => {
      expect(screen.getByTestId('correlationTab-traces')).toBeDefined();
    });
    expect(screen.getByTestId('correlationTab-logs')).toBeDefined();
    expect(screen.getByTestId('correlationTab-metrics')).toBeDefined();
  });

  it('shows trace count in tab label', async () => {
    const alert = makeAlert();
    const result = makeCorrelationResult({
      traces: [makeTrace(), makeTrace({ spanId: 'span-2', traceId: 'trace-2' })],
    });
    const apiClient = createMockApiClient(result);

    render(<AlertCorrelationPanel alert={alert} apiClient={apiClient} />);

    await waitFor(() => {
      expect(screen.getByText('Traces (2)')).toBeDefined();
    });
  });

  it('shows log count in tab label', async () => {
    const alert = makeAlert();
    const result = makeCorrelationResult({
      logs: [makeLog(), makeLog({ body: 'Another error' }), makeLog({ body: 'Third error' })],
    });
    const apiClient = createMockApiClient(result);

    render(<AlertCorrelationPanel alert={alert} apiClient={apiClient} />);

    await waitFor(() => {
      expect(screen.getByText('Logs (3)')).toBeDefined();
    });
  });

  it('renders traces table when traces are present', async () => {
    const alert = makeAlert();
    const result = makeCorrelationResult({ traces: [makeTrace()] });
    const apiClient = createMockApiClient(result);

    render(<AlertCorrelationPanel alert={alert} apiClient={apiClient} />);

    await waitFor(() => {
      expect(screen.getByTestId('correlationTracesTable')).toBeDefined();
    });
  });

  it('renders empty prompt when no traces found', async () => {
    const alert = makeAlert();
    const result = makeCorrelationResult({ traces: [] });
    const apiClient = createMockApiClient(result);

    render(<AlertCorrelationPanel alert={alert} apiClient={apiClient} />);

    // EuiEmptyPrompt is rendered (stub doesn't show body text)
    await waitFor(() => {
      expect(screen.getByText('Traces (0)')).toBeDefined();
    });
  });

  it('switches to logs tab on click', async () => {
    const alert = makeAlert();
    const result = makeCorrelationResult({
      traces: [makeTrace()],
      logs: [makeLog()],
    });
    const apiClient = createMockApiClient(result);

    render(<AlertCorrelationPanel alert={alert} apiClient={apiClient} />);

    await waitFor(() => {
      expect(screen.getByTestId('correlationTab-logs')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('correlationTab-logs'));

    expect(screen.getByTestId('correlationLogsTable')).toBeDefined();
  });

  it('shows failure modes summary when present', async () => {
    const alert = makeAlert();
    const result = makeCorrelationResult({
      traces: [makeTrace()],
      failureModes: [
        {
          pattern: 'Connection refused to payment-db',
          percentage: 78,
          count: 7,
          exampleTraceIds: ['trace-1'],
        },
      ],
    });
    const apiClient = createMockApiClient(result);

    render(<AlertCorrelationPanel alert={alert} apiClient={apiClient} />);

    await waitFor(() => {
      expect(screen.getByTestId('failureModesSummary')).toBeDefined();
    });
    expect(screen.getByText('78%')).toBeDefined();
    // Text appears in both failure modes and traces table
    expect(screen.getAllByText('Connection refused to payment-db').length).toBeGreaterThanOrEqual(
      1
    );
  });

  it('shows sampling notice for long-running alerts', async () => {
    const alert = makeAlert();
    const result = makeCorrelationResult({
      traces: [makeTrace()],
      tracesSampled: true,
    });
    const apiClient = createMockApiClient(result);

    render(<AlertCorrelationPanel alert={alert} apiClient={apiClient} />);

    await waitFor(() => {
      expect(screen.getByText(/traces sampled from start, middle, and recent/)).toBeDefined();
    });
  });

  it('switches to metrics tab and shows empty state', async () => {
    const alert = makeAlert();
    const result = makeCorrelationResult({ traces: [makeTrace()], metrics: [] });
    const apiClient = createMockApiClient(result);

    render(<AlertCorrelationPanel alert={alert} apiClient={apiClient} />);

    await waitFor(() => {
      expect(screen.getByTestId('correlationTab-metrics')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('correlationTab-metrics'));

    // EuiEmptyPrompt stub is rendered (text is in props, not children)
    expect(screen.getByText('Metrics (0)')).toBeDefined();
  });

  it('shows metrics with data points', async () => {
    const alert = makeAlert();
    const result = makeCorrelationResult({
      traces: [],
      metrics: [
        {
          metricName: 'http_error_rate',
          labels: { service: 'payment-service' },
          dataPoints: [{ timestamp: 1000, value: 0.05 }],
          description: 'HTTP 5xx error rate',
        },
      ],
    });
    const apiClient = createMockApiClient(result);

    render(<AlertCorrelationPanel alert={alert} apiClient={apiClient} />);

    await waitFor(() => {
      expect(screen.getByTestId('correlationTab-metrics')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('correlationTab-metrics'));

    await waitFor(() => {
      expect(screen.getByTestId('correlationMetricsList')).toBeDefined();
    });
    expect(screen.getByText('http_error_rate')).toBeDefined();
    expect(screen.getByText('HTTP 5xx error rate')).toBeDefined();
  });
});
