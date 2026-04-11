/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Alert Correlation Service — orchestrates cross-signal correlation for alerts.
 *
 * Given an alert with a service label, fetches correlated traces (error spans),
 * logs (ERROR/FATAL), and metrics from OTEL datasets within the alert's time
 * window (expanded by +/- 5 minutes for telemetry lag compensation).
 *
 * For SLO burn rate alerts, identifies the fastest error budget burn window
 * and surfaces dominant failure modes from trace attributes.
 *
 * Caching: results are cached with a 2-minute TTL to avoid repeated queries
 * for the same alert/service combination.
 */

import type {
  AlertCorrelationProvider,
  AlertCorrelationResult,
  CorrelatedTrace,
  CorrelatedMetric,
  CorrelationTimeWindow,
  FailureMode,
  Logger,
  UnifiedAlertSummary,
  PromTimeSeriesPoint,
} from './types';

/** Time window expansion in ms (5 minutes each side). */
const WINDOW_EXPANSION_MS = 5 * 60_000;

/** For alerts longer than this, sample traces from start/middle/end windows. */
const LONG_ALERT_THRESHOLD_MS = 30 * 60_000; // 30 minutes

/** Sample window size for long-running alerts. */
const SAMPLE_WINDOW_MS = 5 * 60_000; // 5-minute windows

/** Cache TTL for correlation results. */
const CACHE_TTL_MS = 2 * 60_000; // 2 minutes

/** Max traces per correlation request. */
const MAX_TRACES = 50;

/** Max logs per correlation request. */
const MAX_LOGS = 100;

interface CacheEntry {
  result: AlertCorrelationResult;
  fetchedAt: number;
}

/**
 * Optional Prometheus query interface — used to fetch alerting metric data.
 * Avoids importing the full PrometheusBackend to keep this module light.
 */
export interface MetricQueryProvider {
  queryRange(
    dsId: string,
    query: string,
    start: number,
    end: number,
    step: number
  ): Promise<PromTimeSeriesPoint[]>;
}

export class AlertCorrelationService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly provider: AlertCorrelationProvider,
    private readonly logger: Logger,
    private readonly metricQuery?: MetricQueryProvider
  ) {}

  /**
   * Get correlated signals for an alert.
   *
   * @param alert The alert to correlate (must have labels.service).
   * @param sloQuery Optional PromQL query from an SLO burn rate alert for metric correlation.
   * @param datasourceId Optional Prometheus datasource ID for metric queries.
   */
  async getCorrelations(
    alert: UnifiedAlertSummary,
    sloQuery?: string,
    datasourceId?: string
  ): Promise<AlertCorrelationResult> {
    const serviceName = alert.labels?.service;
    if (!serviceName) {
      return this.emptyResult(alert.id, '', this.defaultWindow());
    }

    // Check cache
    const cacheKey = `${alert.id}:${serviceName}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.result;
    }

    const alertStart = new Date(alert.startTime).getTime();
    const alertEnd = alert.lastUpdated ? new Date(alert.lastUpdated).getTime() : Date.now();

    const baseWindow: CorrelationTimeWindow = {
      start: alertStart - WINDOW_EXPANSION_MS,
      end: Math.min(alertEnd + WINDOW_EXPANSION_MS, Date.now()),
    };

    const alertDuration = alertEnd - alertStart;
    const isLongRunning = alertDuration > LONG_ALERT_THRESHOLD_MS;

    try {
      // Fetch traces — sample if long-running
      let traces: CorrelatedTrace[];
      let sampled = false;
      if (isLongRunning) {
        traces = await this.sampleTraces(serviceName, alertStart, alertEnd);
        sampled = true;
      } else {
        traces = await this.provider.getCorrelatedTraces(serviceName, baseWindow, MAX_TRACES);
      }

      // Fetch logs and metrics in parallel
      const [logs, providerMetrics] = await Promise.all([
        this.provider.getCorrelatedLogs(serviceName, baseWindow, MAX_LOGS),
        this.provider.getCorrelatedMetrics(serviceName, baseWindow),
      ]);

      // Enrich with Prometheus metric data if available
      const metrics = await this.enrichMetrics(
        providerMetrics,
        serviceName,
        baseWindow,
        sloQuery,
        datasourceId
      );

      // Compute failure modes from error traces
      const failureModes = this.computeFailureModes(traces);

      const result: AlertCorrelationResult = {
        alertId: alert.id,
        serviceName,
        timeWindow: baseWindow,
        traces,
        logs,
        metrics,
        failureModes,
        tracesSampled: sampled,
      };

      this.cache.set(cacheKey, { result, fetchedAt: Date.now() });
      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`AlertCorrelationService: correlation failed for ${serviceName}: ${msg}`);
      return this.emptyResult(alert.id, serviceName, baseWindow);
    }
  }

  /** Clear cached results. */
  clearCache(): void {
    this.cache.clear();
  }

  // ---------------------------------------------------------------------------
  // Time Window Intelligence
  // ---------------------------------------------------------------------------

  /**
   * For long-running alerts, sample traces from three windows:
   * start, middle, and most recent — to avoid overwhelming results.
   */
  private async sampleTraces(
    serviceName: string,
    alertStart: number,
    alertEnd: number
  ): Promise<CorrelatedTrace[]> {
    const midpoint = alertStart + (alertEnd - alertStart) / 2;
    const windows: CorrelationTimeWindow[] = [
      // Start window
      {
        start: alertStart - WINDOW_EXPANSION_MS,
        end: alertStart + SAMPLE_WINDOW_MS,
      },
      // Middle window
      {
        start: midpoint - SAMPLE_WINDOW_MS / 2,
        end: midpoint + SAMPLE_WINDOW_MS / 2,
      },
      // Recent window
      {
        start: Math.max(alertEnd - SAMPLE_WINDOW_MS, midpoint + SAMPLE_WINDOW_MS / 2),
        end: Math.min(alertEnd + WINDOW_EXPANSION_MS, Date.now()),
      },
    ];

    const perWindow = Math.ceil(MAX_TRACES / 3);
    const results = await Promise.all(
      windows.map((w) => this.provider.getCorrelatedTraces(serviceName, w, perWindow))
    );

    // Merge and deduplicate by spanId
    const seen = new Set<string>();
    const merged: CorrelatedTrace[] = [];
    for (const batch of results) {
      for (const trace of batch) {
        if (!seen.has(trace.spanId)) {
          seen.add(trace.spanId);
          merged.push(trace);
        }
      }
    }
    return merged;
  }

  // ---------------------------------------------------------------------------
  // Metric Enrichment
  // ---------------------------------------------------------------------------

  private async enrichMetrics(
    providerMetrics: CorrelatedMetric[],
    serviceName: string,
    window: CorrelationTimeWindow,
    sloQuery?: string,
    datasourceId?: string
  ): Promise<CorrelatedMetric[]> {
    const metrics = [...providerMetrics];

    // If we have a Prometheus query provider and SLO query, fetch the alerting metric
    if (this.metricQuery && sloQuery && datasourceId) {
      try {
        const step = Math.max(60, Math.floor((window.end - window.start) / 100));
        const points = await this.metricQuery.queryRange(
          datasourceId,
          sloQuery,
          Math.floor(window.start / 1000),
          Math.floor(window.end / 1000),
          step
        );
        if (points.length > 0) {
          metrics.push({
            metricName: 'slo_burn_rate',
            labels: { service: serviceName },
            dataPoints: points,
            description: 'SLO error budget burn rate',
          });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.debug(`AlertCorrelationService: metric query failed: ${msg}`);
      }
    }

    return metrics;
  }

  // ---------------------------------------------------------------------------
  // Failure Mode Analysis
  // ---------------------------------------------------------------------------

  /**
   * Group error traces by common patterns to identify dominant failure modes.
   * Looks at span attributes for error descriptions, status messages, and
   * target services.
   */
  private computeFailureModes(traces: CorrelatedTrace[]): FailureMode[] {
    if (traces.length === 0) return [];

    const errorTraces = traces.filter((t) => t.statusCode === 2);
    if (errorTraces.length === 0) return [];

    // Group by failure pattern
    const groups = new Map<string, { count: number; traceIds: string[] }>();
    for (const trace of errorTraces) {
      const pattern = this.extractFailurePattern(trace);
      const existing = groups.get(pattern);
      if (existing) {
        existing.count++;
        if (existing.traceIds.length < 3) {
          existing.traceIds.push(trace.traceId);
        }
      } else {
        groups.set(pattern, { count: 1, traceIds: [trace.traceId] });
      }
    }

    // Convert to sorted array
    const totalErrors = errorTraces.length;
    const modes: FailureMode[] = [];
    for (const [pattern, data] of groups) {
      modes.push({
        pattern,
        percentage: Math.round((data.count / totalErrors) * 100),
        count: data.count,
        exampleTraceIds: data.traceIds,
      });
    }

    // Sort by count descending, return top 5
    modes.sort((a, b) => b.count - a.count);
    return modes.slice(0, 5);
  }

  /**
   * Extract a human-readable failure pattern from trace attributes.
   * Priority: error message > status message > operation name + target.
   */
  private extractFailurePattern(trace: CorrelatedTrace): string {
    const attrs = trace.attributes;

    // Common error attribute keys in OTEL spans
    const errorMsg =
      attrs['exception.message'] ||
      attrs['error.message'] ||
      attrs['otel.status_description'] ||
      attrs['http.status_code'];

    if (errorMsg) {
      // Normalize: truncate long messages, strip instance-specific details
      const normalized = errorMsg
        .substring(0, 80)
        .replace(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g, '<ip>');
      return normalized;
    }

    // Fallback: use operation name + target
    const target = attrs['peer.service'] || attrs['db.system'] || attrs['rpc.service'] || '';
    if (target) {
      return `${trace.operationName} to ${target}`;
    }

    return trace.operationName || 'unknown error';
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private emptyResult(
    alertId: string,
    serviceName: string,
    window: CorrelationTimeWindow
  ): AlertCorrelationResult {
    return {
      alertId,
      serviceName,
      timeWindow: window,
      traces: [],
      logs: [],
      metrics: [],
      failureModes: [],
      tracesSampled: false,
    };
  }

  private defaultWindow(): CorrelationTimeWindow {
    const now = Date.now();
    return { start: now - 15 * 60_000, end: now };
  }
}
