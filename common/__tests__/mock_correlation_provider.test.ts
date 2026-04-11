/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { MockCorrelationProvider } from '../mock_backend';
import type { CorrelationTimeWindow } from '../types';

const defaultWindow: CorrelationTimeWindow = {
  start: Date.now() - 15 * 60_000,
  end: Date.now(),
};

describe('MockCorrelationProvider', () => {
  const provider = new MockCorrelationProvider();

  describe('getCorrelatedTraces', () => {
    it('returns error traces for known services', async () => {
      const traces = await provider.getCorrelatedTraces('payment-service', defaultWindow);
      expect(traces.length).toBeGreaterThan(0);
      expect(traces[0].serviceName).toBe('payment-service');
      expect(traces[0].statusCode).toBe(2); // Error
    });

    it('returns default traces for unknown services', async () => {
      const traces = await provider.getCorrelatedTraces('unknown-service', defaultWindow);
      expect(traces.length).toBeGreaterThan(0);
    });

    it('respects maxResults parameter', async () => {
      const traces = await provider.getCorrelatedTraces('payment-service', defaultWindow, 2);
      expect(traces.length).toBeLessThanOrEqual(2);
    });

    it('includes realistic attributes', async () => {
      const traces = await provider.getCorrelatedTraces('payment-service', defaultWindow);
      // Use array syntax because the key contains a dot
      expect(traces[0].attributes).toHaveProperty(['exception.message']);
    });
  });

  describe('getCorrelatedLogs', () => {
    it('returns error/fatal logs for known services', async () => {
      const logs = await provider.getCorrelatedLogs('payment-service', defaultWindow);
      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0].serviceName).toBe('payment-service');
      expect(['ERROR', 'FATAL']).toContain(logs[0].severityText);
    });

    it('returns default logs for unknown services', async () => {
      const logs = await provider.getCorrelatedLogs('unknown-service', defaultWindow);
      expect(logs.length).toBeGreaterThan(0);
    });

    it('links some logs to trace IDs', async () => {
      const logs = await provider.getCorrelatedLogs('payment-service', defaultWindow);
      const linked = logs.filter((l) => l.traceId);
      expect(linked.length).toBeGreaterThan(0);
    });
  });

  describe('getCorrelatedMetrics', () => {
    it('returns metric data with data points', async () => {
      const metrics = await provider.getCorrelatedMetrics('payment-service', defaultWindow);
      expect(metrics.length).toBeGreaterThan(0);
      expect(metrics[0].metricName).toBe('http_error_rate');
      expect(metrics[0].dataPoints.length).toBeGreaterThan(0);
    });

    it('includes service label in metrics', async () => {
      const metrics = await provider.getCorrelatedMetrics('order-service', defaultWindow);
      expect(metrics[0].labels.service).toBe('order-service');
    });
  });
});
