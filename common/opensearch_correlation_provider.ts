/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Live correlation provider that queries OTEL signal indices in OpenSearch.
 * Fetches correlated traces from `ss4o_traces-*-*` and logs from `ss4o_logs-*-*`
 * for a given service and time window.
 */

import type {
  AlertCorrelationProvider,
  CorrelatedTrace,
  CorrelatedLog,
  CorrelatedMetric,
  CorrelationTimeWindow,
  Logger,
} from './types';
import { HttpClient } from './http_client';

const TRACES_INDEX = 'ss4o_traces-*-*';
const LOGS_INDEX = 'ss4o_logs-*-*';

/** Default max results per signal type. */
const DEFAULT_MAX_TRACES = 50;
const DEFAULT_MAX_LOGS = 100;

export class OpenSearchCorrelationProvider implements AlertCorrelationProvider {
  constructor(
    private readonly httpClient: HttpClient,
    private readonly opensearchUrl: string,
    private readonly auth?: { username: string; password: string },
    private readonly rejectUnauthorized?: boolean,
    private readonly logger?: Logger
  ) {}

  async getCorrelatedTraces(
    serviceName: string,
    window: CorrelationTimeWindow,
    maxResults = DEFAULT_MAX_TRACES
  ): Promise<CorrelatedTrace[]> {
    try {
      const url = `${this.opensearchUrl}/${TRACES_INDEX}/_search`;
      const resp = await this.httpClient.request<TraceSearchResponse>({
        method: 'POST',
        url,
        body: {
          size: maxResults,
          query: {
            bool: {
              filter: [
                { term: { serviceName } },
                { term: { 'status.code': 2 } }, // Error spans only
                {
                  range: {
                    startTime: {
                      gte: new Date(window.start).toISOString(),
                      lte: new Date(window.end).toISOString(),
                    },
                  },
                },
              ],
            },
          },
          sort: [{ startTime: { order: 'desc' } }],
          _source: [
            'traceId',
            'spanId',
            'serviceName',
            'name',
            'status.code',
            'durationInNanos',
            'startTime',
            'resource.attributes',
            'span.attributes',
          ],
        },
        auth: this.auth,
        rejectUnauthorized: this.rejectUnauthorized ?? false,
        timeoutMs: 10_000,
      });

      const hits = resp.body?.hits?.hits ?? [];
      return hits.map((hit) => this.parseTraceHit(hit));
    } catch (err: unknown) {
      if (this.isIndexNotFound(err)) {
        this.logger?.debug('OpenSearchCorrelationProvider: traces index not found');
        return [];
      }
      const msg = err instanceof Error ? err.message : String(err);
      this.logger?.warn(`OpenSearchCorrelationProvider: failed to fetch traces: ${msg}`);
      return [];
    }
  }

  async getCorrelatedLogs(
    serviceName: string,
    window: CorrelationTimeWindow,
    maxResults = DEFAULT_MAX_LOGS
  ): Promise<CorrelatedLog[]> {
    try {
      const url = `${this.opensearchUrl}/${LOGS_INDEX}/_search`;
      const resp = await this.httpClient.request<LogSearchResponse>({
        method: 'POST',
        url,
        body: {
          size: maxResults,
          query: {
            bool: {
              filter: [
                { term: { serviceName } },
                {
                  terms: {
                    'severity.text': ['ERROR', 'FATAL'],
                  },
                },
                {
                  range: {
                    '@timestamp': {
                      gte: new Date(window.start).toISOString(),
                      lte: new Date(window.end).toISOString(),
                    },
                  },
                },
              ],
            },
          },
          sort: [{ '@timestamp': { order: 'desc' } }],
          _source: [
            '@timestamp',
            'serviceName',
            'severity.text',
            'body',
            'traceId',
            'spanId',
            'resource.attributes',
          ],
        },
        auth: this.auth,
        rejectUnauthorized: this.rejectUnauthorized ?? false,
        timeoutMs: 10_000,
      });

      const hits = resp.body?.hits?.hits ?? [];
      return hits.map((hit) => this.parseLogHit(hit));
    } catch (err: unknown) {
      if (this.isIndexNotFound(err)) {
        this.logger?.debug('OpenSearchCorrelationProvider: logs index not found');
        return [];
      }
      const msg = err instanceof Error ? err.message : String(err);
      this.logger?.warn(`OpenSearchCorrelationProvider: failed to fetch logs: ${msg}`);
      return [];
    }
  }

  async getCorrelatedMetrics(
    _serviceName: string,
    _window: CorrelationTimeWindow
  ): Promise<CorrelatedMetric[]> {
    // Metrics correlation is handled via Prometheus queryRange in the correlation service,
    // not via OpenSearch index queries. Return empty here — the service layer enriches.
    return [];
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private parseTraceHit(hit: TraceHit): CorrelatedTrace {
    const src = hit._source ?? {};
    const durationNanos = src.durationInNanos ?? 0;
    const attrs: Record<string, string> = {};

    // Flatten resource + span attributes into a single map
    if (src.resource?.attributes) {
      for (const [k, v] of Object.entries(src.resource.attributes)) {
        attrs[k] = String(v);
      }
    }
    if (src.span?.attributes) {
      for (const [k, v] of Object.entries(src.span.attributes)) {
        attrs[k] = String(v);
      }
    }

    return {
      traceId: src.traceId ?? '',
      spanId: src.spanId ?? '',
      serviceName: src.serviceName ?? '',
      operationName: src.name ?? '',
      statusCode: src.status?.code ?? 0,
      durationMs: Math.round(durationNanos / 1_000_000),
      startTime: src.startTime ?? '',
      attributes: attrs,
    };
  }

  private parseLogHit(hit: LogHit): CorrelatedLog {
    const src = hit._source ?? {};
    const attrs: Record<string, string> = {};

    if (src.resource?.attributes) {
      for (const [k, v] of Object.entries(src.resource.attributes)) {
        attrs[k] = String(v);
      }
    }

    return {
      timestamp: src['@timestamp'] ?? '',
      serviceName: src.serviceName ?? '',
      severityText: src.severity?.text ?? 'ERROR',
      body: src.body ?? '',
      traceId: src.traceId,
      spanId: src.spanId,
      attributes: attrs,
    };
  }

  private isIndexNotFound(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return msg.includes('index_not_found_exception') || msg.includes('no such index');
  }
}

// ---------------------------------------------------------------------------
// Response types (internal)
// ---------------------------------------------------------------------------

interface TraceSource {
  traceId?: string;
  spanId?: string;
  serviceName?: string;
  name?: string;
  status?: { code?: number };
  durationInNanos?: number;
  startTime?: string;
  resource?: { attributes?: Record<string, unknown> };
  span?: { attributes?: Record<string, unknown> };
}

interface TraceHit {
  _id: string;
  _source?: TraceSource;
}

interface TraceSearchResponse {
  hits?: { hits: TraceHit[]; total?: { value: number } };
}

interface LogSource {
  '@timestamp'?: string;
  serviceName?: string;
  severity?: { text?: string };
  body?: string;
  traceId?: string;
  spanId?: string;
  resource?: { attributes?: Record<string, unknown> };
}

interface LogHit {
  _id: string;
  _source?: LogSource;
}

interface LogSearchResponse {
  hits?: { hits: LogHit[]; total?: { value: number } };
}
