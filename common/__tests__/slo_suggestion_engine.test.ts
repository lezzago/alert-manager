/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  SloSuggestionEngine,
  DETECTION_PATTERNS,
  buildPrefilledSloInput,
  buildDependencyPrefilledSloInput,
} from '../slo_suggestion_engine';
import { SLO_TEMPLATES } from '../slo_templates';
import type { PrometheusMetadataService } from '../prometheus_metadata_service';
import type { SloService } from '../slo_service';
import type { Logger, EnrichedOtelService } from '../types';

// ============================================================================
// Helpers
// ============================================================================

const logger: Logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

function createMockMetadataService(
  metrics: string[] = [],
  labelValues: Record<string, string[]> = {}
): PrometheusMetadataService {
  return {
    getMetricNames: jest.fn().mockResolvedValue(metrics),
    getLabelNames: jest.fn().mockResolvedValue([]),
    getLabelValues: jest.fn().mockImplementation((_dsId: string, labelName: string) => {
      return Promise.resolve(labelValues[labelName] ?? []);
    }),
    getMetricMetadata: jest.fn().mockResolvedValue([]),
    invalidate: jest.fn(),
    invalidateAll: jest.fn(),
  } as unknown as PrometheusMetadataService;
}

function createMockSloService(
  slos: Array<{
    id: string;
    sliType: string;
    serviceName: string;
    operationName?: string;
  }> = []
): SloService {
  return {
    list: jest.fn().mockResolvedValue(
      slos.map((s) => ({
        id: s.id,
        sliType: s.sliType,
        serviceName: s.serviceName,
        operationName: s.operationName ?? '',
      }))
    ),
    seed: jest.fn(),
    setStore: jest.fn(),
  } as unknown as SloService;
}

function createMockService(name: string, deps: string[] = []): EnrichedOtelService {
  return {
    name,
    environment: 'production',
    dependencies: deps,
    lastSeen: new Date().toISOString(),
    sloCount: 0,
    activeAlertCount: 0,
    signals: { hasTraces: true, hasLogs: true, hasMetrics: true },
  } as unknown as EnrichedOtelService;
}

// ============================================================================
// DETECTION_PATTERNS
// ============================================================================

describe('DETECTION_PATTERNS', () => {
  it('has 5 patterns', () => {
    expect(DETECTION_PATTERNS).toHaveLength(5);
  });

  it('each pattern maps to a valid template', () => {
    const templateIds = SLO_TEMPLATES.map((t) => t.id);
    for (const pattern of DETECTION_PATTERNS) {
      expect(templateIds).toContain(pattern.templateId);
    }
  });

  it('has default target of 0.999 for all patterns', () => {
    for (const pattern of DETECTION_PATTERNS) {
      expect(pattern.defaultTarget).toBe(0.999);
    }
  });

  it('OTEL patterns have additionalSelectors', () => {
    const otelPatterns = DETECTION_PATTERNS.filter((p) => p.id.startsWith('otel-'));
    expect(otelPatterns).toHaveLength(2);
    for (const p of otelPatterns) {
      expect(p.additionalSelectors).toBeDefined();
      expect(p.additionalSelectors!.namespace).toBe('span_derived');
    }
  });
});

// ============================================================================
// buildPrefilledSloInput
// ============================================================================

describe('buildPrefilledSloInput', () => {
  it('returns a valid SloInput from HTTP availability template', () => {
    const template = SLO_TEMPLATES.find((t) => t.id === 'http-availability')!;
    const pattern = DETECTION_PATTERNS.find((p) => p.id === 'http-availability')!;
    const result = buildPrefilledSloInput(template, 'api-gateway', 'ds-2', pattern);

    expect(result.name).toBe('api-gateway — HTTP Availability');
    expect(result.datasourceId).toBe('ds-2');
    expect(result.sli.metric).toBe('http_requests_total');
    expect(result.sli.type).toBe('availability');
    expect(result.sli.service.labelValue).toBe('api-gateway');
    expect(result.sli.service.labelName).toBe('service');
    expect(result.sli.operation.labelValue).toBe('');
    expect(result.sli.goodEventsFilter).toBe('status_code!~"5.."');
    expect(result.sli.latencyThreshold).toBeUndefined();
    expect(result.target).toBe(0.999);
    expect(result.window.duration).toBe('7d');
    expect(result.burnRates).toHaveLength(4);
  });

  it('sets latencyThreshold for latency templates', () => {
    const template = SLO_TEMPLATES.find((t) => t.id === 'http-latency-p99')!;
    const pattern = DETECTION_PATTERNS.find((p) => p.id === 'http-latency-p99')!;
    const result = buildPrefilledSloInput(template, 'api-gateway', 'ds-2', pattern);

    expect(result.sli.type).toBe('latency_p99');
    expect(result.sli.latencyThreshold).toBe(0.5);
    expect(result.sli.goodEventsFilter).toBeUndefined();
  });

  it('works for OTEL span availability template', () => {
    const template = SLO_TEMPLATES.find((t) => t.id === 'otel-span-availability')!;
    const pattern = DETECTION_PATTERNS.find((p) => p.id === 'otel-span-availability')!;
    const result = buildPrefilledSloInput(template, 'payment-service', 'ds-2', pattern);

    expect(result.sli.metric).toBe('request');
    expect(result.sli.goodEventsFilter).toBe('fault=0');
    expect(result.sli.service.labelName).toBe('service');
    expect(result.name).toBe('payment-service — OTEL Span Availability');
  });
});

// ============================================================================
// buildDependencyPrefilledSloInput
// ============================================================================

describe('buildDependencyPrefilledSloInput', () => {
  it('creates a dependency SLO input', () => {
    const result = buildDependencyPrefilledSloInput('api-gateway', 'payment-db', 'ds-2');

    expect(result.name).toBe('api-gateway → payment-db Latency P99');
    expect(result.sli.sourceType).toBe('service_dependency');
    expect(result.sli.dependency).toBeDefined();
    expect(result.sli.dependency!.labelName).toBe('remoteService');
    expect(result.sli.dependency!.labelValue).toBe('payment-db');
    expect(result.sli.service.labelValue).toBe('api-gateway');
    expect(result.sli.latencyThreshold).toBe(0.05);
  });
});

// ============================================================================
// SloSuggestionEngine.getSuggestions
// ============================================================================

describe('SloSuggestionEngine.getSuggestions', () => {
  it('returns empty suggestions when no metrics match', async () => {
    const metadata = createMockMetadataService([], {});
    const sloService = createMockSloService();
    const engine = new SloSuggestionEngine(metadata, sloService, logger);

    const result = await engine.getSuggestions('api-gateway', 'ds-2');

    expect(result.service).toBe('api-gateway');
    expect(result.suggestions).toHaveLength(0);
    expect(result.existingSloIds).toHaveLength(0);
  });

  it('returns HTTP availability suggestion when metric and service exist', async () => {
    const metadata = createMockMetadataService(['http_requests_total'], {
      service: ['api-gateway', 'other-service'],
    });
    const sloService = createMockSloService();
    const engine = new SloSuggestionEngine(metadata, sloService, logger);

    const result = await engine.getSuggestions('api-gateway', 'ds-2');

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].templateId).toBe('http-availability');
    expect(result.suggestions[0].confidence).toBe('high');
    expect(result.suggestions[0].alreadyCovered).toBe(false);
    expect(result.suggestions[0].prefilled.sli.metric).toBe('http_requests_total');
  });

  it('returns multiple suggestions when multiple metrics exist', async () => {
    const metadata = createMockMetadataService(
      ['http_requests_total', 'http_request_duration_seconds_bucket'],
      { service: ['api-gateway'] }
    );
    const sloService = createMockSloService();
    const engine = new SloSuggestionEngine(metadata, sloService, logger);

    const result = await engine.getSuggestions('api-gateway', 'ds-2');

    expect(result.suggestions).toHaveLength(2);
    const ids = result.suggestions.map((s) => s.templateId);
    expect(ids).toContain('http-availability');
    expect(ids).toContain('http-latency-p99');
  });

  it('skips suggestion when service is not in label values', async () => {
    const metadata = createMockMetadataService(['http_requests_total'], {
      service: ['other-service'],
    });
    const sloService = createMockSloService();
    const engine = new SloSuggestionEngine(metadata, sloService, logger);

    const result = await engine.getSuggestions('api-gateway', 'ds-2');

    expect(result.suggestions).toHaveLength(0);
  });

  it('marks existing SLOs as already covered', async () => {
    const metadata = createMockMetadataService(['http_requests_total'], {
      service: ['api-gateway'],
    });
    const sloService = createMockSloService([
      { id: 'slo-1', sliType: 'availability', serviceName: 'api-gateway' },
    ]);
    const engine = new SloSuggestionEngine(metadata, sloService, logger);

    const result = await engine.getSuggestions('api-gateway', 'ds-2');

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].alreadyCovered).toBe(true);
    expect(result.existingSloIds).toEqual(['slo-1']);
  });

  it('handles OTEL span metrics with namespace selector', async () => {
    const metadata = createMockMetadataService(['request', 'latency_seconds_bucket'], {
      service: ['api-gateway'],
      namespace: ['span_derived', 'default'],
    });
    const sloService = createMockSloService();
    const engine = new SloSuggestionEngine(metadata, sloService, logger);

    const result = await engine.getSuggestions('api-gateway', 'ds-2');

    const otelSuggestions = result.suggestions.filter((s) => s.templateId.startsWith('otel-'));
    expect(otelSuggestions).toHaveLength(2);
  });

  it('generates dependency suggestions when dependencies provided', async () => {
    const metadata = createMockMetadataService(['latency_seconds_bucket'], {
      service: ['api-gateway'],
      namespace: ['span_derived'],
      remoteService: ['payment-db'],
    });
    const sloService = createMockSloService();
    const engine = new SloSuggestionEngine(metadata, sloService, logger);

    const result = await engine.getSuggestions('api-gateway', 'ds-2', ['payment-db']);

    const depSuggestions = result.suggestions.filter((s) => s.templateId.startsWith('dep-'));
    expect(depSuggestions).toHaveLength(1);
    expect(depSuggestions[0].confidence).toBe('medium');
    expect(depSuggestions[0].templateName).toContain('payment-db');
  });

  it('gracefully handles metadata service errors', async () => {
    const metadata = {
      getMetricNames: jest.fn().mockRejectedValue(new Error('Connection refused')),
      getLabelValues: jest.fn().mockResolvedValue([]),
    } as unknown as PrometheusMetadataService;
    const sloService = createMockSloService();
    const engine = new SloSuggestionEngine(metadata, sloService, logger);

    const result = await engine.getSuggestions('api-gateway', 'ds-2');

    expect(result.suggestions).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalled();
  });
});

// ============================================================================
// SloSuggestionEngine.getBadgeData
// ============================================================================

describe('SloSuggestionEngine.getBadgeData', () => {
  it('returns badge data for services', async () => {
    const metadata = createMockMetadataService(
      ['http_requests_total', 'http_request_duration_seconds_bucket'],
      { service: ['api-gateway'] }
    );
    const sloService = createMockSloService([
      { id: 'slo-1', sliType: 'availability', serviceName: 'api-gateway' },
    ]);
    const engine = new SloSuggestionEngine(metadata, sloService, logger);

    const services = [createMockService('api-gateway')];
    const result = await engine.getBadgeData(services, 'ds-2');

    expect(result.size).toBe(1);
    const badge = result.get('api-gateway')!;
    expect(badge.totalSuggested).toBe(2);
    expect(badge.alreadyCreated).toBe(1); // availability covered
  });

  it('returns empty map on error', async () => {
    const metadata = {
      getMetricNames: jest.fn().mockRejectedValue(new Error('fail')),
    } as unknown as PrometheusMetadataService;
    const sloService = createMockSloService();
    const engine = new SloSuggestionEngine(metadata, sloService, logger);

    const services = [createMockService('api-gateway')];
    const result = await engine.getBadgeData(services, 'ds-2');

    expect(result.size).toBe(0);
  });

  it('returns 0 suggested for services without matching metrics', async () => {
    const metadata = createMockMetadataService([], {});
    const sloService = createMockSloService();
    const engine = new SloSuggestionEngine(metadata, sloService, logger);

    const services = [createMockService('api-gateway')];
    const result = await engine.getBadgeData(services, 'ds-2');

    const badge = result.get('api-gateway')!;
    expect(badge.totalSuggested).toBe(0);
    expect(badge.alreadyCreated).toBe(0);
  });
});
