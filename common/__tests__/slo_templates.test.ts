/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  SLO_TEMPLATES,
  detectMetricType,
  GOOD_EVENTS_FILTER_PRESETS,
  formatErrorBudget,
} from '../slo_templates';
import type { PrometheusMetricMetadata } from '../types';

// ============================================================================
// SLO_TEMPLATES
// ============================================================================

describe('SLO_TEMPLATES', () => {
  it('has exactly 7 entries', () => {
    expect(SLO_TEMPLATES).toHaveLength(7);
  });

  it('has the correct template ids', () => {
    const ids = SLO_TEMPLATES.map((t) => t.id);
    expect(ids).toEqual([
      'http-availability',
      'http-latency-p99',
      'grpc-availability',
      'grpc-latency-p99',
      'otel-span-availability',
      'otel-span-latency-p99',
      'custom',
    ]);
  });

  it('every template has a non-empty name and description', () => {
    for (const t of SLO_TEMPLATES) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
    }
  });

  it('custom template has empty metricPattern', () => {
    const custom = SLO_TEMPLATES.find((t) => t.id === 'custom');
    expect(custom).toBeDefined();
    expect(custom!.metricPattern).toBe('');
  });
});

// ============================================================================
// detectMetricType — suffix heuristics
// ============================================================================

describe('detectMetricType — suffix heuristics', () => {
  it('returns counter + availability for _total suffix', () => {
    const result = detectMetricType('http_requests_total');
    expect(result.type).toBe('counter');
    expect(result.suggestedSliType).toBe('availability');
  });

  it('returns histogram + latency_p99 for _bucket suffix', () => {
    const result = detectMetricType('http_request_duration_seconds_bucket');
    expect(result.type).toBe('histogram');
    expect(result.suggestedSliType).toBe('latency_p99');
  });

  it('returns histogram (not counter!) for _count suffix', () => {
    const result = detectMetricType('http_request_duration_seconds_count');
    expect(result.type).toBe('histogram');
    expect(result.suggestedSliType).toBe('latency_p99');
  });

  it('returns unknown for metric with no recognized suffix', () => {
    const result = detectMetricType('unknown_metric');
    expect(result.type).toBe('unknown');
    expect(result.suggestedSliType).toBe('availability');
    expect(result.suggestedTemplate).toBeNull();
  });
});

// ============================================================================
// detectMetricType — metadata override
// ============================================================================

describe('detectMetricType — metadata override', () => {
  it('uses metadata type when provided', () => {
    const metadata: PrometheusMetricMetadata = {
      metric: 'my_gauge_metric',
      type: 'gauge',
      help: 'A gauge metric',
    };
    const result = detectMetricType('my_gauge_metric', metadata);
    expect(result.type).toBe('gauge');
    expect(result.suggestedSliType).toBe('availability');
  });

  it('falls back to suffix heuristics when metadata type is unknown', () => {
    const metadata: PrometheusMetricMetadata = {
      metric: 'http_requests_total',
      type: 'unknown',
      help: '',
    };
    const result = detectMetricType('http_requests_total', metadata);
    expect(result.type).toBe('counter');
  });
});

// ============================================================================
// detectMetricType — template matching
// ============================================================================

describe('detectMetricType — template matching', () => {
  it('matches http_requests_total to http-availability template', () => {
    const result = detectMetricType('http_requests_total');
    expect(result.suggestedTemplate).not.toBeNull();
    expect(result.suggestedTemplate!.id).toBe('http-availability');
  });

  it('matches http_request_duration_seconds_bucket to http-latency-p99 template', () => {
    const result = detectMetricType('http_request_duration_seconds_bucket');
    expect(result.suggestedTemplate).not.toBeNull();
    expect(result.suggestedTemplate!.id).toBe('http-latency-p99');
  });

  it('matches grpc_server_handled_total to grpc-availability template', () => {
    const result = detectMetricType('grpc_server_handled_total');
    expect(result.suggestedTemplate).not.toBeNull();
    expect(result.suggestedTemplate!.id).toBe('grpc-availability');
  });

  it('returns null template for unrecognized metric name', () => {
    const result = detectMetricType('unknown_metric');
    expect(result.suggestedTemplate).toBeNull();
  });

  it('matches "request" to otel-span-availability template', () => {
    const result = detectMetricType('request');
    expect(result.suggestedTemplate).not.toBeNull();
    expect(result.suggestedTemplate!.id).toBe('otel-span-availability');
  });

  it('matches latency_seconds_bucket to otel-span-latency-p99 template', () => {
    const result = detectMetricType('latency_seconds_bucket');
    expect(result.suggestedTemplate).not.toBeNull();
    expect(result.suggestedTemplate!.id).toBe('otel-span-latency-p99');
  });

  it('matches latency_seconds_count to otel-span-latency-p99 template', () => {
    const result = detectMetricType('latency_seconds_count');
    expect(result.suggestedTemplate).not.toBeNull();
    expect(result.suggestedTemplate!.id).toBe('otel-span-latency-p99');
  });
});

// ============================================================================
// GOOD_EVENTS_FILTER_PRESETS
// ============================================================================

describe('GOOD_EVENTS_FILTER_PRESETS', () => {
  it('has exactly 6 entries', () => {
    expect(GOOD_EVENTS_FILTER_PRESETS).toHaveLength(6);
  });

  it('every preset has non-empty label and value', () => {
    for (const preset of GOOD_EVENTS_FILTER_PRESETS) {
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.value.length).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
// formatErrorBudget
// ============================================================================

describe('formatErrorBudget', () => {
  it('returns seconds/day for 99.9% over 1d', () => {
    const result = formatErrorBudget(0.999, '1d');
    expect(result.raw).toBeCloseTo(86.4, 1);
    expect(result.formatted).toBe('Error budget: 86.4 seconds/day');
  });

  it('returns minutes/month for 99.9% over 30d', () => {
    const result = formatErrorBudget(0.999, '30d');
    // raw = 0.001 * 30 * 86400 = 2592 seconds
    expect(result.raw).toBeCloseTo(2592, 0);
    // 2592 / 60 = 43.2 minutes
    expect(result.formatted).toBe('Error budget: 43.2 minutes/month');
  });

  it('returns hours/week for 99% over 7d', () => {
    const result = formatErrorBudget(0.99, '7d');
    // raw = 0.01 * 7 * 86400 = 6048 seconds
    expect(result.raw).toBeCloseTo(6048, 0);
    // 6048 / 3600 = 1.68 hours
    expect(result.formatted).toBe('Error budget: 1.68 hours/week');
  });

  it('uses raw duration string for non-standard windows', () => {
    const result = formatErrorBudget(0.999, '3d');
    expect(result.formatted).toContain('3d');
  });

  it('uses "month" label for 28d window', () => {
    const result = formatErrorBudget(0.999, '28d');
    expect(result.formatted).toContain('month');
  });

  it('formats whole numbers without trailing .0', () => {
    // Target 0.99 over 1d = 0.01 * 86400 = 864 seconds = 14.4 minutes (not >= 100)
    // Target 0.9 over 30d = 0.1 * 2592000 = 259200 seconds = 72 hours
    const result = formatErrorBudget(0.9, '30d');
    expect(result.raw).toBeCloseTo(259200, 0);
    expect(result.formatted).toBe('Error budget: 72 hours/month');
  });
});
