/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { OpenSearchCorrelationProvider } from '../opensearch_correlation_provider';
import type { CorrelationTimeWindow, Logger } from '../types';
import type { HttpClient } from '../http_client';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function createMockHttpClient(response?: unknown): HttpClient {
  return {
    request: jest
      .fn()
      .mockResolvedValue({ status: 200, body: response ?? { hits: { hits: [] } }, headers: {} }),
  } as unknown as HttpClient;
}

const logger: Logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

const defaultWindow: CorrelationTimeWindow = {
  start: Date.now() - 15 * 60_000,
  end: Date.now(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OpenSearchCorrelationProvider', () => {
  describe('getCorrelatedTraces', () => {
    it('returns parsed traces from OpenSearch response', async () => {
      const httpClient = createMockHttpClient({
        hits: {
          hits: [
            {
              _id: 'hit-1',
              _source: {
                traceId: 'trace-abc',
                spanId: 'span-xyz',
                serviceName: 'payment-service',
                name: 'POST /api/charge',
                status: { code: 2 },
                durationInNanos: 2_340_000_000,
                startTime: '2025-01-15T10:00:00Z',
                resource: { attributes: { 'deployment.environment': 'production' } },
                span: { attributes: { 'http.status_code': '500' } },
              },
            },
          ],
        },
      });
      const provider = new OpenSearchCorrelationProvider(
        httpClient,
        'https://localhost:9200',
        { username: 'admin', password: 'admin' },
        false,
        logger
      );

      const traces = await provider.getCorrelatedTraces('payment-service', defaultWindow);

      expect(traces).toHaveLength(1);
      expect(traces[0].traceId).toBe('trace-abc');
      expect(traces[0].spanId).toBe('span-xyz');
      expect(traces[0].operationName).toBe('POST /api/charge');
      expect(traces[0].statusCode).toBe(2);
      expect(traces[0].durationMs).toBe(2340);
      expect(traces[0].attributes['http.status_code']).toBe('500');
      expect(traces[0].attributes['deployment.environment']).toBe('production');
    });

    it('returns empty array when index not found', async () => {
      const httpClient = {
        request: jest.fn().mockRejectedValue(new Error('index_not_found_exception')),
      } as unknown as HttpClient;
      const provider = new OpenSearchCorrelationProvider(
        httpClient,
        'https://localhost:9200',
        undefined,
        false,
        logger
      );

      const traces = await provider.getCorrelatedTraces('unknown-service', defaultWindow);

      expect(traces).toEqual([]);
      expect(logger.debug).toHaveBeenCalled();
    });

    it('returns empty array on query failure', async () => {
      const httpClient = {
        request: jest.fn().mockRejectedValue(new Error('connection refused')),
      } as unknown as HttpClient;
      const provider = new OpenSearchCorrelationProvider(
        httpClient,
        'https://localhost:9200',
        undefined,
        false,
        logger
      );

      const traces = await provider.getCorrelatedTraces('payment-service', defaultWindow);

      expect(traces).toEqual([]);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('sends correct DSL query with service name and error filter', async () => {
      const httpClient = createMockHttpClient();
      const provider = new OpenSearchCorrelationProvider(
        httpClient,
        'https://localhost:9200',
        { username: 'admin', password: 'admin' },
        false,
        logger
      );

      await provider.getCorrelatedTraces('payment-service', defaultWindow, 25);

      const call = (httpClient.request as jest.Mock).mock.calls[0][0];
      expect(call.url).toContain('ss4o_traces-*-*/_search');
      expect(call.body.size).toBe(25);
      expect(call.body.query.bool.filter).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ term: { serviceName: 'payment-service' } }),
          expect.objectContaining({ term: { 'status.code': 2 } }),
        ])
      );
    });
  });

  describe('getCorrelatedLogs', () => {
    it('returns parsed logs from OpenSearch response', async () => {
      const httpClient = createMockHttpClient({
        hits: {
          hits: [
            {
              _id: 'log-1',
              _source: {
                '@timestamp': '2025-01-15T10:00:00Z',
                serviceName: 'payment-service',
                severity: { text: 'ERROR' },
                body: 'Connection refused to payment-db',
                traceId: 'trace-abc',
                spanId: 'span-xyz',
                resource: { attributes: { 'deployment.environment': 'production' } },
              },
            },
          ],
        },
      });
      const provider = new OpenSearchCorrelationProvider(
        httpClient,
        'https://localhost:9200',
        { username: 'admin', password: 'admin' },
        false,
        logger
      );

      const logs = await provider.getCorrelatedLogs('payment-service', defaultWindow);

      expect(logs).toHaveLength(1);
      expect(logs[0].severityText).toBe('ERROR');
      expect(logs[0].body).toBe('Connection refused to payment-db');
      expect(logs[0].traceId).toBe('trace-abc');
    });

    it('filters for ERROR and FATAL severity', async () => {
      const httpClient = createMockHttpClient();
      const provider = new OpenSearchCorrelationProvider(
        httpClient,
        'https://localhost:9200',
        { username: 'admin', password: 'admin' },
        false,
        logger
      );

      await provider.getCorrelatedLogs('payment-service', defaultWindow);

      const call = (httpClient.request as jest.Mock).mock.calls[0][0];
      expect(call.body.query.bool.filter).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ terms: { 'severity.text': ['ERROR', 'FATAL'] } }),
        ])
      );
    });

    it('returns empty array on index not found', async () => {
      const httpClient = {
        request: jest.fn().mockRejectedValue(new Error('no such index')),
      } as unknown as HttpClient;
      const provider = new OpenSearchCorrelationProvider(
        httpClient,
        'https://localhost:9200',
        undefined,
        false,
        logger
      );

      const logs = await provider.getCorrelatedLogs('unknown-service', defaultWindow);

      expect(logs).toEqual([]);
    });
  });

  describe('getCorrelatedMetrics', () => {
    it('returns empty array (metrics handled by service layer)', async () => {
      const httpClient = createMockHttpClient();
      const provider = new OpenSearchCorrelationProvider(
        httpClient,
        'https://localhost:9200',
        undefined,
        false,
        logger
      );

      const metrics = await provider.getCorrelatedMetrics('payment-service', defaultWindow);

      expect(metrics).toEqual([]);
    });
  });
});
