/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SLO templates, metric type detection, good events filter presets,
 * and error budget calculation utilities.
 *
 * Templates provide one-click SLO creation for common observability
 * patterns (HTTP, gRPC). The `detectMetricType()` function infers
 * the Prometheus metric type from metadata or naming conventions,
 * enabling the wizard to auto-suggest the correct SLI configuration.
 *
 * All exports are pure functions and readonly data — no I/O, no side effects.
 * Used both server-side (for API validation) and client-side (for the wizard).
 *
 * @see https://prometheus.io/docs/concepts/metric_types/
 * @see https://sre.google/workbook/implementing-slos/
 */

import type { SliType, SliCalcMethod } from './slo_types';
import type { PrometheusMetricMetadata } from './types';
import { parseDurationToMs } from './slo_promql_generator';

// ============================================================================
// T2.1: SLO Template Interface + Built-in Templates
// ============================================================================

/**
 * An SLO template provides pre-configured defaults for common observability
 * patterns. When a user selects a template in the Create SLO wizard, all
 * relevant fields (metric, SLI type, label names, filters) are pre-filled,
 * reducing the form to just service name and operation name.
 *
 * Templates are matched against metric names via `detectionPattern` to enable
 * auto-suggestion when users type or select a metric.
 */
export interface SloTemplate {
  /** Unique template identifier (kebab-case). */
  id: string;
  /** Human-readable template name shown in the template selector UI. */
  name: string;
  /** Short description explaining when to use this template. */
  description: string;
  /** OUI icon name for the template card (e.g. 'globe', 'clock', 'visBarVertical'). */
  icon: string;
  /**
   * Default metric name pre-filled when the template is selected.
   * For the Custom template, this is empty — the user must provide their own.
   */
  metricPattern: string;
  /** SLI type that this template configures (availability or a latency quantile). */
  sliType: SliType;
  /** Calculation method for the SLI. */
  calcMethod: SliCalcMethod;
  /**
   * Default Prometheus label name used to identify the service.
   * Typically "service" for HTTP metrics or "grpc_service" for gRPC.
   */
  serviceLabelName: string;
  /**
   * Default Prometheus label name used to identify the operation/endpoint.
   * Typically "handler", "endpoint", or "grpc_method".
   */
  operationLabelName: string;
  /**
   * Pre-configured good events filter for availability SLIs.
   * Uses PromQL label matcher syntax (e.g. `status_code!~"5.."`).
   * Undefined for latency templates (they use histogram bucket thresholds instead).
   */
  goodEventsFilter?: string;
  /**
   * Default latency threshold in seconds for latency SLI templates.
   * Follows the Prometheus convention of seconds for histogram `le` labels.
   * Undefined for availability templates.
   */
  latencyThreshold?: number;
  /**
   * Expected Prometheus metric type.
   * - Availability SLIs expect counters (monotonically increasing request totals).
   * - Latency SLIs expect histograms (bucketed duration observations).
   */
  expectedMetricType: 'counter' | 'histogram';
  /**
   * Regex pattern matched against metric names for auto-detection.
   * When a user selects or types a metric, the system tests each template's
   * detectionPattern to suggest the best match.
   */
  detectionPattern: RegExp;
}

/**
 * Built-in SLO templates covering the most common observability patterns.
 *
 * Templates are ordered by frequency of use: HTTP first (most services),
 * then gRPC (common in microservices), then Custom (catch-all).
 *
 * This array is extensible — downstream consumers can concatenate additional
 * templates: `[...SLO_TEMPLATES, myCustomTemplate]`.
 */
export const SLO_TEMPLATES: readonly SloTemplate[] = [
  {
    id: 'http-availability',
    name: 'HTTP Availability',
    description:
      'Track the ratio of successful HTTP requests (non-5xx) to total requests. ' +
      'Best for services exposing http_requests_total counters.',
    icon: 'globe',
    metricPattern: 'http_requests_total',
    sliType: 'availability',
    calcMethod: 'good_requests',
    serviceLabelName: 'service',
    operationLabelName: 'handler',
    goodEventsFilter: 'status_code!~"5.."',
    expectedMetricType: 'counter',
    detectionPattern: /^https?_requests?_total$|^http_server_requests?_total$/,
  },
  {
    id: 'http-latency-p99',
    name: 'HTTP Latency P99',
    description:
      'Track the 99th percentile request duration from histogram buckets. ' +
      'Best for services exposing http_request_duration_seconds histogram.',
    icon: 'clock',
    metricPattern: 'http_request_duration_seconds_bucket',
    sliType: 'latency_p99',
    calcMethod: 'good_requests',
    serviceLabelName: 'service',
    operationLabelName: 'handler',
    latencyThreshold: 0.5,
    expectedMetricType: 'histogram',
    detectionPattern: /^https?_request_duration_(seconds|milliseconds)_(bucket|count|sum)$/,
  },
  {
    id: 'grpc-availability',
    name: 'gRPC Availability',
    description:
      'Track the ratio of successful gRPC calls (non-error codes) to total calls. ' +
      'Best for gRPC services exposing grpc_server_handled_total counters.',
    icon: 'visBarVertical',
    metricPattern: 'grpc_server_handled_total',
    sliType: 'availability',
    calcMethod: 'good_requests',
    serviceLabelName: 'grpc_service',
    operationLabelName: 'grpc_method',
    goodEventsFilter:
      'grpc_code!~"INTERNAL|UNAVAILABLE|DEADLINE_EXCEEDED|UNKNOWN|RESOURCE_EXHAUSTED|DATA_LOSS"',
    expectedMetricType: 'counter',
    detectionPattern: /^grpc_server_handled_total$/,
  },
  {
    id: 'grpc-latency-p99',
    name: 'gRPC Latency P99',
    description:
      'Track the 99th percentile gRPC call duration from histogram buckets. ' +
      'Best for gRPC services exposing grpc_server_handling_seconds histogram.',
    icon: 'clock',
    metricPattern: 'grpc_server_handling_seconds_bucket',
    sliType: 'latency_p99',
    calcMethod: 'good_requests',
    serviceLabelName: 'grpc_service',
    operationLabelName: 'grpc_method',
    latencyThreshold: 0.5,
    expectedMetricType: 'histogram',
    detectionPattern: /^grpc_server_handling_(seconds|milliseconds)_(bucket|count|sum)$/,
  },
  {
    id: 'otel-span-availability',
    name: 'OTEL Span Availability',
    description:
      'Track availability from OTEL span-derived metrics. Uses the request counter ' +
      'generated by Data Prepper from OpenTelemetry trace spans.',
    icon: 'apmTrace',
    metricPattern: 'request',
    sliType: 'availability',
    calcMethod: 'good_requests',
    serviceLabelName: 'service',
    operationLabelName: 'endpoint',
    goodEventsFilter: 'fault=0',
    expectedMetricType: 'counter',
    detectionPattern: /^request$/,
  },
  {
    id: 'otel-span-latency-p99',
    name: 'OTEL Span Latency P99',
    description:
      'Track p99 latency from OTEL span-derived histogram metrics. Uses the latency ' +
      'histogram generated by Data Prepper from OpenTelemetry trace spans.',
    icon: 'clock',
    metricPattern: 'latency_seconds_bucket',
    sliType: 'latency_p99',
    calcMethod: 'good_requests',
    serviceLabelName: 'service',
    operationLabelName: 'endpoint',
    latencyThreshold: 0.5,
    expectedMetricType: 'histogram',
    detectionPattern: /^latency_seconds_(bucket|count|sum)$/,
  },
  {
    id: 'custom',
    name: 'Custom',
    description:
      'Start from a blank slate. Manually configure the metric, SLI type, ' +
      'label names, and filters for any Prometheus metric.',
    icon: 'wrench',
    metricPattern: '',
    sliType: 'availability',
    calcMethod: 'good_requests',
    serviceLabelName: 'service',
    operationLabelName: 'endpoint',
    expectedMetricType: 'counter',
    // Matches any metric name — Custom is the catch-all fallback
    detectionPattern: /./,
  },
] as const;

// ============================================================================
// T2.2: Metric Type Detection
// ============================================================================

/**
 * Inferred Prometheus metric type.
 *
 * The canonical types are defined by the Prometheus data model:
 * - counter: monotonically increasing (e.g. request totals)
 * - gauge: arbitrary up/down values (e.g. temperature, queue size)
 * - histogram: bucketed observations (e.g. request durations)
 * - summary: pre-computed quantiles (e.g. legacy latency metrics)
 * - unknown: could not determine from metadata or naming convention
 */
export type InferredMetricType = 'counter' | 'histogram' | 'gauge' | 'summary' | 'unknown';

/**
 * Result of metric type detection, including SLI type suggestion and
 * matching template for one-click SLO configuration.
 */
export interface MetricDetectionResult {
  /** Inferred Prometheus metric type. */
  type: InferredMetricType;
  /**
   * Suggested SLI type based on the metric type:
   * - Counters suggest availability (ratio of good/total requests)
   * - Histograms suggest latency_p99 (99th percentile duration)
   * - Gauges/summaries/unknown default to availability
   */
  suggestedSliType: SliType;
  /**
   * The best-matching built-in template, or null if no template matches.
   * The Custom template is excluded from auto-matching — it's only used
   * when explicitly selected by the user.
   */
  suggestedTemplate: SloTemplate | null;
}

/**
 * Detect the Prometheus metric type and suggest an SLI configuration.
 *
 * Detection strategy (ordered by reliability):
 * 1. If `metadata` is provided (from the Prometheus `/api/v1/metadata` endpoint),
 *    use its `type` field directly. This is the most reliable source.
 * 2. Fall back to **suffix heuristics** based on Prometheus naming conventions:
 *    - `_total` or `_count` suffix → counter
 *    - `_bucket` suffix → histogram
 *    - `_gauge` suffix → gauge (rare but used by some exporters)
 *    - `_sum` suffix → could be histogram or summary (treated as histogram)
 *    - No matching suffix → unknown
 * 3. Match the metric name against template `detectionPattern` regexes
 *    (excluding the Custom template which matches everything).
 *
 * @param metricName - The Prometheus metric name (e.g. "http_requests_total")
 * @param metadata - Optional metadata from the Prometheus metadata API
 * @returns Detection result with type, suggested SLI type, and matching template
 *
 * @example
 * ```typescript
 * // With metadata (most reliable)
 * detectMetricType('http_requests_total', { metric: 'http_requests_total', type: 'counter', help: '...' });
 * // => { type: 'counter', suggestedSliType: 'availability', suggestedTemplate: httpAvailabilityTemplate }
 *
 * // Without metadata (suffix heuristics)
 * detectMetricType('http_request_duration_seconds_bucket');
 * // => { type: 'histogram', suggestedSliType: 'latency_p99', suggestedTemplate: httpLatencyTemplate }
 *
 * // Unknown metric type
 * detectMetricType('my_custom_metric');
 * // => { type: 'unknown', suggestedSliType: 'availability', suggestedTemplate: null }
 * ```
 */
export function detectMetricType(
  metricName: string,
  metadata?: PrometheusMetricMetadata
): MetricDetectionResult {
  // Step 1: Use metadata if available
  let type: InferredMetricType = 'unknown';

  if (metadata?.type && metadata.type !== 'unknown') {
    type = metadata.type;
  } else {
    // Step 2: Suffix-based heuristics
    type = inferTypeFromSuffix(metricName);
  }

  // Step 3: Determine suggested SLI type from metric type
  const suggestedSliType = mapMetricTypeToSliType(type);

  // Step 4: Match against template detection patterns (exclude Custom)
  const suggestedTemplate = findMatchingTemplate(metricName);

  return { type, suggestedSliType, suggestedTemplate };
}

/**
 * Infer the Prometheus metric type from the metric name suffix.
 *
 * Prometheus has strong naming conventions:
 * - Counters end with `_total` (e.g. `http_requests_total`)
 * - Histograms produce `_bucket`, `_count`, `_sum` series
 * - Gauges have no mandatory suffix (but `_gauge` is sometimes used)
 * - Summaries produce `_count`, `_sum`, plus quantile series
 *
 * Note: `_count` and `_sum` are ambiguous between histograms and summaries.
 * We favor histogram since it's more common in modern Prometheus setups.
 */
function inferTypeFromSuffix(metricName: string): InferredMetricType {
  if (metricName.endsWith('_total')) return 'counter';
  if (metricName.endsWith('_bucket')) return 'histogram';
  if (metricName.endsWith('_count')) return 'histogram';
  if (metricName.endsWith('_sum')) return 'histogram';
  if (metricName.endsWith('_gauge')) return 'gauge';
  return 'unknown';
}

/**
 * Map a Prometheus metric type to the most appropriate SLI type.
 *
 * - Counters are best suited for availability SLIs (ratio of good/total)
 * - Histograms are best suited for latency SLIs (percentile from buckets)
 * - Gauges, summaries, and unknown types default to availability since
 *   it's the most general-purpose SLI type
 */
function mapMetricTypeToSliType(type: InferredMetricType): SliType {
  switch (type) {
    case 'histogram':
      return 'latency_p99';
    case 'counter':
    case 'gauge':
    case 'summary':
    case 'unknown':
      return 'availability';
  }
}

/**
 * Find the first built-in template whose detection pattern matches the metric name.
 * The Custom template (which matches everything via `/./`) is excluded from
 * auto-matching to avoid false positives.
 *
 * @returns The matching template, or null if no specific template matches
 */
function findMatchingTemplate(metricName: string): SloTemplate | null {
  for (const template of SLO_TEMPLATES) {
    // Skip the Custom catch-all — only match specific templates
    if (template.id === 'custom') continue;
    if (template.detectionPattern.test(metricName)) {
      return template;
    }
  }
  return null;
}

// ============================================================================
// T2.3: Good Events Filter Presets
// ============================================================================

/**
 * A preset for the "good events" label filter in availability SLIs.
 *
 * Availability SLIs need to distinguish "good" requests from "bad" requests.
 * This is done via a PromQL label matcher on the counter metric. Presets
 * provide common patterns so users don't have to type PromQL syntax manually.
 */
export interface GoodEventsFilterPreset {
  /** Human-readable label shown in the dropdown. */
  label: string;
  /**
   * PromQL label matcher value (e.g. `status_code!~"5.."`).
   * Users can type custom matchers directly in the EuiComboBox via `onCreateOption`.
   */
  value: string;
  /**
   * Optional description with more context about when to use this filter.
   */
  description?: string;
}

/**
 * Pre-defined good events filter options for the SLO creation wizard.
 *
 * These cover the most common HTTP and gRPC status code patterns.
 * Users can type custom PromQL matchers directly via the ComboBox's
 * `onCreateOption` handler, so no explicit "Custom" entry is needed.
 *
 * Ordering rationale:
 * 1. HTTP filters first (most common use case)
 * 2. gRPC filters second (common in microservices)
 */
export const GOOD_EVENTS_FILTER_PRESETS: readonly GoodEventsFilterPreset[] = [
  {
    label: 'HTTP success (non-5xx)',
    value: 'status_code!~"5.."',
    description:
      'Counts all requests except server errors (5xx) as good. ' +
      'Client errors (4xx) are counted as good — the server handled them correctly.',
  },
  {
    label: 'HTTP 2xx only',
    value: 'status_code=~"2.."',
    description:
      'Only counts 2xx responses as good. Stricter than non-5xx — ' +
      'redirects (3xx) and client errors (4xx) are counted as bad.',
  },
  {
    label: 'HTTP non-error (non-4xx/5xx)',
    value: 'status_code=~"[123].."',
    description:
      'Only counts 1xx/2xx/3xx responses as good. Use when 4xx responses indicate a problem worth tracking (e.g. auth failures).',
  },
  {
    label: 'gRPC OK',
    value: 'grpc_code="OK"',
    description:
      'Only counts gRPC calls with status OK as good. ' +
      'All other status codes (including benign ones like NOT_FOUND) are counted as bad.',
  },
  {
    label: 'gRPC non-error',
    value: 'grpc_code!~"INTERNAL|UNAVAILABLE|DEADLINE_EXCEEDED"',
    description:
      'Excludes only the most severe gRPC error codes. ' +
      'Codes like NOT_FOUND, ALREADY_EXISTS, and PERMISSION_DENIED are counted as good.',
  },
  {
    label: 'OTEL span success (no fault)',
    value: 'fault=0',
    description:
      'Counts all spans without faults as good. Used with Data Prepper span-derived metrics.',
  },
] as const;

// ============================================================================
// T2.4: Error Budget Calculation Utility
// ============================================================================

/**
 * Formatted error budget result for display in the SLO creation wizard.
 */
export interface ErrorBudgetDisplay {
  /**
   * Raw error budget in seconds.
   * This is the total number of seconds of allowable downtime (or bad requests
   * proportional time) within the SLO measurement window.
   *
   * Calculated as: `(1 - target) * windowDurationInSeconds`
   *
   * Example: For 99.9% over 30 days:
   *   (1 - 0.999) * 30 * 86400 = 0.001 * 2592000 = 2592 seconds
   */
  raw: number;
  /**
   * Human-readable formatted string for UI display.
   *
   * Examples:
   * - "Error budget: 86.4 seconds/day"
   * - "Error budget: 43.2 minutes/month"
   * - "Error budget: 1.68 hours/week"
   *
   * Unit selection:
   * - seconds if raw < 120 seconds
   * - minutes if raw < 90 minutes (5400 seconds)
   * - hours otherwise
   *
   * Window label mapping: 1d → "day", 7d → "week", 30d → "month", other → "window"
   */
  formatted: string;
}

/**
 * Calculate and format the error budget for an SLO target and window duration.
 *
 * The error budget is the total amount of allowable "bad time" within the
 * measurement window. It's the complement of the SLO target:
 *
 *   error_budget_seconds = (1 - target) * window_duration_seconds
 *
 * This gives operators an intuitive sense of how much room they have.
 * For example, "99.9% over 30 days" sounds abstract, but "43.2 minutes/month
 * of allowable downtime" is immediately actionable.
 *
 * @param target - SLO target as a decimal (e.g. 0.999 for 99.9%)
 * @param windowDuration - Prometheus duration string (e.g. "1d", "7d", "30d")
 * @returns Error budget in raw seconds and a human-readable formatted string
 *
 * @example
 * ```typescript
 * formatErrorBudget(0.999, '1d');
 * // => { raw: 86.4, formatted: 'Error budget: 86.4 seconds/day' }
 *
 * formatErrorBudget(0.999, '30d');
 * // => { raw: 2592, formatted: 'Error budget: 43.2 minutes/month' }
 *
 * formatErrorBudget(0.99, '7d');
 * // => { raw: 6048, formatted: 'Error budget: 1.68 hours/week' }
 * ```
 */
export function formatErrorBudget(target: number, windowDuration: string): ErrorBudgetDisplay {
  const windowMs = parseDurationToMs(windowDuration);
  const windowSeconds = windowMs / 1000;

  // Error budget = fraction of time/requests that can be "bad"
  const errorRate = 1 - target;
  const raw = errorRate * windowSeconds;

  // Choose human-readable units based on magnitude
  const formatted = formatBudgetString(raw, windowDuration);

  return { raw, formatted };
}

/**
 * Format the error budget with appropriate units and window label.
 *
 * Unit thresholds:
 * - < 120 seconds: display in seconds (e.g. "86.4 seconds")
 * - < 5400 seconds (90 minutes): display in minutes (e.g. "43.2 minutes")
 * - >= 5400 seconds: display in hours (e.g. "1.68 hours")
 *
 * The 90-minute threshold ensures values like "100.8 minutes" are shown as
 * "1.68 hours" instead, which is more intuitive at that magnitude.
 *
 * Values are formatted to at most 3 significant digits for readability.
 */
function formatBudgetString(budgetSeconds: number, windowDuration: string): string {
  const windowLabel = getWindowLabel(windowDuration);

  let value: number;
  let unit: string;

  if (budgetSeconds < 120) {
    // Display in seconds (e.g. 86.4 seconds)
    value = budgetSeconds;
    unit = 'seconds';
  } else if (budgetSeconds < 5400) {
    // Display in minutes for values under 90 minutes (e.g. 43.2 minutes)
    value = budgetSeconds / 60;
    unit = 'minutes';
  } else {
    // Display in hours for larger values (e.g. 1.68 hours)
    value = budgetSeconds / 3600;
    unit = 'hours';
  }

  // Format to at most 3 significant digits, removing trailing zeros
  const formatted = formatNumber(value);

  return `Error budget: ${formatted} ${unit}/${windowLabel}`;
}

/**
 * Map a Prometheus window duration to a human-readable period label.
 *
 * Standard mappings:
 * - "1d" → "day"
 * - "7d" → "week"
 * - "28d" or "30d" → "month"
 * - Everything else → the raw duration string (e.g. "3d" → "3d")
 */
function getWindowLabel(windowDuration: string): string {
  switch (windowDuration) {
    case '1d':
      return 'day';
    case '7d':
      return 'week';
    case '28d':
    case '30d':
      return 'month';
    default:
      return windowDuration;
  }
}

/**
 * Format a number to at most 3 significant digits, removing trailing zeros.
 *
 * Examples:
 * - 86.4 → "86.4"
 * - 43.2 → "43.2"
 * - 1.68 → "1.68"
 * - 100.0 → "100"
 * - 0.864 → "0.864"
 */
function formatNumber(value: number): string {
  // Use toPrecision(3) for values with significant fractional parts,
  // but avoid scientific notation for very small or large values
  if (value === 0) return '0';

  // For values >= 100, use toFixed to avoid toPrecision losing decimal places
  if (value >= 100) {
    const fixed = value.toFixed(1);
    return fixed.replace(/\.0$/, '');
  }

  // For smaller values, use toPrecision(3) for clean formatting
  return parseFloat(value.toPrecision(3)).toString();
}
