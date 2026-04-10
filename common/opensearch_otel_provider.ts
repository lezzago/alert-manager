/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Live OTEL service discovery provider that queries the `otel-v1-apm-service-map*`
 * index via OpenSearch DSL. Uses composite aggregation for scalable enumeration
 * of services and their dependencies.
 *
 * The service map index is populated by Data Prepper from OTEL span data.
 * Each document represents an observed service-to-service connection.
 */

import type { OtelService, OtelSignals, OtelServiceDiscoveryProvider, Logger } from './types';
import { HttpClient } from './http_client';

/** Index patterns used by OTEL/Data Prepper. */
const SERVICE_MAP_INDEX = 'otel-v1-apm-service-map*';
const TRACES_INDEX = 'ss4o_traces-*-*';
const LOGS_INDEX = 'ss4o_logs-*-*';
const METRICS_INDEX = 'ss4o_metrics-*-*';

/** Maximum services returned per discovery call. */
const MAX_SERVICES = 500;

export class OpenSearchOtelProvider implements OtelServiceDiscoveryProvider {
  constructor(
    private readonly httpClient: HttpClient,
    private readonly opensearchUrl: string,
    private readonly auth?: { username: string; password: string },
    private readonly rejectUnauthorized?: boolean,
    private readonly logger?: Logger
  ) {}

  async discoverServices(timeRangeMinutes = 60): Promise<OtelService[]> {
    const services: OtelService[] = [];
    let afterKey: Record<string, string> | undefined;

    // Composite aggregation paginates through all unique services
    do {
      const result = await this.fetchServiceBatch(timeRangeMinutes, afterKey);
      if (!result) break;

      services.push(...result.services);
      afterKey = result.afterKey;
    } while (afterKey && services.length < MAX_SERVICES);

    return services;
  }

  async getAvailableSignals(serviceName: string): Promise<OtelSignals> {
    const [hasTraces, hasLogs, hasMetrics] = await Promise.all([
      this.hasDocsForService(TRACES_INDEX, 'serviceName', serviceName),
      this.hasDocsForService(LOGS_INDEX, 'serviceName', serviceName),
      this.hasDocsForService(METRICS_INDEX, 'serviceName', serviceName),
    ]);
    return { hasTraces, hasLogs, hasMetrics };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async fetchServiceBatch(
    timeRangeMinutes: number,
    afterKey?: Record<string, string>
  ): Promise<{ services: OtelService[]; afterKey?: Record<string, string> } | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const compositeAgg: Record<string, any> = {
      size: 100,
      sources: [
        { service_name: { terms: { field: 'sourceNode.keyAttributes.name' } } },
        { environment: { terms: { field: 'sourceNode.keyAttributes.environment' } } },
      ],
    };
    if (afterKey) {
      compositeAgg.after = afterKey;
    }

    const body = {
      size: 0,
      query: {
        bool: {
          filter: [{ range: { timestamp: { gte: `now-${timeRangeMinutes}m` } } }],
        },
      },
      aggs: {
        services: {
          composite: compositeAgg,
          aggs: {
            dependencies: {
              terms: {
                field: 'targetNode.keyAttributes.name',
                size: 50,
              },
            },
            sdk_language: {
              terms: {
                field: 'sourceNode.groupByAttributes.telemetry.sdk.language',
                size: 1,
              },
            },
            service_type: {
              terms: {
                field: 'sourceNode.keyAttributes.type',
                size: 1,
              },
            },
            last_seen: {
              max: { field: 'timestamp' },
            },
          },
        },
      },
    };

    try {
      const url = `${this.opensearchUrl}/${SERVICE_MAP_INDEX}/_search`;
      const resp = await this.httpClient.request<SearchResponse>({
        method: 'POST',
        url,
        body,
        auth: this.auth,
        rejectUnauthorized: this.rejectUnauthorized ?? false,
        timeoutMs: 15_000,
      });

      const agg = resp.body?.aggregations?.services;
      if (!agg || !Array.isArray(agg.buckets)) {
        return null;
      }

      const services: OtelService[] = agg.buckets.map((bucket: CompositeBucket) => ({
        name: bucket.key.service_name,
        environment: bucket.key.environment,
        type: bucket.service_type?.buckets?.[0]?.key,
        sdkLanguage: bucket.sdk_language?.buckets?.[0]?.key,
        dependencies: (bucket.dependencies?.buckets ?? [])
          .map((d: { key: string }) => d.key)
          .filter((d: string) => d !== '' && d !== 'null'),
        lastSeen: bucket.last_seen?.value_as_string ?? new Date().toISOString(),
      }));

      const newAfterKey = agg.after_key as Record<string, string> | undefined;
      return { services, afterKey: newAfterKey };
    } catch (err: unknown) {
      if (this.isIndexNotFound(err)) {
        this.logger?.debug(
          'OpenSearchOtelProvider: service map index not found — no OTEL data available'
        );
        return null;
      }
      const msg = err instanceof Error ? err.message : String(err);
      this.logger?.warn(`OpenSearchOtelProvider: failed to discover services: ${msg}`);
      return null;
    }
  }

  private async hasDocsForService(
    index: string,
    serviceField: string,
    serviceName: string
  ): Promise<boolean> {
    try {
      const url = `${this.opensearchUrl}/${index}/_count`;
      const resp = await this.httpClient.request<{ count: number }>({
        method: 'POST',
        url,
        body: {
          query: { term: { [serviceField]: serviceName } },
        },
        auth: this.auth,
        rejectUnauthorized: this.rejectUnauthorized ?? false,
        timeoutMs: 5_000,
      });
      return (resp.body?.count ?? 0) > 0;
    } catch {
      // Index doesn't exist or query failed — signal unavailable
      return false;
    }
  }

  private isIndexNotFound(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return msg.includes('index_not_found_exception') || msg.includes('no such index');
  }
}

// ---------------------------------------------------------------------------
// Response types (internal)
// ---------------------------------------------------------------------------

interface CompositeBucket {
  key: { service_name: string; environment: string };
  doc_count: number;
  dependencies?: { buckets: Array<{ key: string; doc_count: number }> };
  sdk_language?: { buckets: Array<{ key: string; doc_count: number }> };
  service_type?: { buckets: Array<{ key: string; doc_count: number }> };
  last_seen?: { value: number; value_as_string: string };
}

interface SearchResponse {
  aggregations?: {
    services?: {
      buckets: CompositeBucket[];
      after_key?: Record<string, string>;
    };
  };
}
