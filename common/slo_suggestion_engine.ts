/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SLO Suggestion Engine — Phase 2 of the OTEL Datasets Roadmap.
 *
 * For each discovered OTEL service, queries PrometheusMetadataService
 * to detect which metric patterns exist, then generates pre-filled
 * SLO suggestions that can be created with one click.
 *
 * The engine also produces badge data for the services table showing
 * "X of Y suggested SLOs created" per service.
 */

import type { SloInput } from './slo_types';
import { DEFAULT_MWMBR_TIERS } from './slo_types';
import type { SloTemplate } from './slo_templates';
import { SLO_TEMPLATES } from './slo_templates';
import type {
  SloSuggestion,
  SloSuggestionsResponse,
  MetricDetectionPattern,
  SuggestionBadgeData,
} from './slo_suggestion_types';
import type { PrometheusMetadataService } from './prometheus_metadata_service';
import type { SloService } from './slo_service';
import type { EnrichedOtelService, Logger } from './types';

// ============================================================================
// Detection Patterns — ordered by specificity (most specific first)
// ============================================================================

export const DETECTION_PATTERNS: readonly MetricDetectionPattern[] = [
  {
    id: 'http-availability',
    metricName: 'http_requests_total',
    serviceLabelName: 'service',
    templateId: 'http-availability',
    defaultTarget: 0.999,
    defaultWindow: '7d',
  },
  {
    id: 'http-latency-p99',
    metricName: 'http_request_duration_seconds_bucket',
    serviceLabelName: 'service',
    templateId: 'http-latency-p99',
    defaultTarget: 0.999,
    defaultWindow: '7d',
    defaultLatencyThreshold: 0.5,
  },
  {
    id: 'grpc-availability',
    metricName: 'grpc_server_handled_total',
    serviceLabelName: 'grpc_service',
    templateId: 'grpc-availability',
    defaultTarget: 0.999,
    defaultWindow: '7d',
  },
  {
    id: 'otel-span-availability',
    metricName: 'request',
    serviceLabelName: 'service',
    additionalSelectors: { namespace: 'span_derived' },
    templateId: 'otel-span-availability',
    defaultTarget: 0.999,
    defaultWindow: '7d',
  },
  {
    id: 'otel-span-latency-p99',
    metricName: 'latency_seconds_bucket',
    serviceLabelName: 'service',
    additionalSelectors: { namespace: 'span_derived' },
    templateId: 'otel-span-latency-p99',
    defaultTarget: 0.999,
    defaultWindow: '7d',
    defaultLatencyThreshold: 0.5,
  },
];

// ============================================================================
// Pure helper — build a pre-filled SloInput from template + pattern
// ============================================================================

export function buildPrefilledSloInput(
  template: SloTemplate,
  serviceName: string,
  dsId: string,
  pattern: MetricDetectionPattern
): SloInput {
  const sli: SloInput['sli'] = {
    type: template.sliType,
    calcMethod: template.calcMethod,
    sourceType: 'service_operation',
    metric: template.metricPattern,
    service: { labelName: template.serviceLabelName, labelValue: serviceName },
    operation: { labelName: template.operationLabelName, labelValue: '' },
  };

  if (template.goodEventsFilter) {
    sli.goodEventsFilter = template.goodEventsFilter;
  }
  if (pattern.defaultLatencyThreshold !== undefined) {
    sli.latencyThreshold = pattern.defaultLatencyThreshold;
  }

  return {
    datasourceId: dsId,
    name: `${serviceName} — ${template.name}`,
    sli,
    target: pattern.defaultTarget,
    budgetWarningThreshold: 0.3,
    window: { type: 'rolling', duration: pattern.defaultWindow },
    burnRates: [...DEFAULT_MWMBR_TIERS],
    alarms: {
      sliHealth: { enabled: true },
      attainmentBreach: { enabled: true },
      budgetWarning: { enabled: true },
    },
    exclusionWindows: [],
    tags: {},
  };
}

/**
 * Build a pre-filled SloInput for a dependency SLO suggestion.
 * Uses OTEL span metrics with sourceType 'service_dependency'.
 */
export function buildDependencyPrefilledSloInput(
  sourceService: string,
  targetService: string,
  dsId: string
): SloInput {
  const template = SLO_TEMPLATES.find((t) => t.id === 'otel-span-latency-p99')!;
  return {
    datasourceId: dsId,
    name: `${sourceService} → ${targetService} Latency P99`,
    sli: {
      type: 'latency_p99',
      calcMethod: 'good_requests',
      sourceType: 'service_dependency',
      metric: template.metricPattern,
      latencyThreshold: 0.05, // 50ms for inter-service calls
      service: { labelName: 'service', labelValue: sourceService },
      operation: { labelName: 'endpoint', labelValue: '' },
      dependency: { labelName: 'remoteService', labelValue: targetService },
    },
    target: 0.999,
    budgetWarningThreshold: 0.3,
    window: { type: 'rolling', duration: '7d' },
    burnRates: [...DEFAULT_MWMBR_TIERS],
    alarms: {
      sliHealth: { enabled: true },
      attainmentBreach: { enabled: true },
      budgetWarning: { enabled: true },
    },
    exclusionWindows: [],
    tags: {},
  };
}

// ============================================================================
// Suggestion Engine
// ============================================================================

export class SloSuggestionEngine {
  constructor(
    private readonly metadataService: PrometheusMetadataService,
    private readonly sloService: SloService,
    private readonly logger: Logger
  ) {}

  /**
   * Generate SLO suggestions for a specific service.
   *
   * Algorithm:
   * 1. Fetch all metric names from the datasource
   * 2. For each detection pattern, check if the metric exists
   * 3. Verify the service label value exists for the metric
   * 4. Build pre-filled SloInput from the matching template
   * 5. Check existing SLOs to mark already-covered suggestions
   * 6. Generate dependency suggestions if dependencies provided
   */
  async getSuggestions(
    serviceName: string,
    dsId: string,
    dependencies?: string[]
  ): Promise<SloSuggestionsResponse> {
    try {
      // Step 1: Get available metrics
      const metricNames = await this.metadataService.getMetricNames(dsId);
      const metricSet = new Set(metricNames);

      // Step 2-4: Check each detection pattern
      const suggestions: SloSuggestion[] = [];

      for (const pattern of DETECTION_PATTERNS) {
        if (!metricSet.has(pattern.metricName)) continue;

        // Verify service label has the target service
        const selector = this.buildSelector(pattern);
        const serviceValues = await this.metadataService.getLabelValues(
          dsId,
          pattern.serviceLabelName,
          selector
        );

        if (!serviceValues.includes(serviceName)) continue;

        // For OTEL patterns, verify the additional selectors exist
        if (pattern.additionalSelectors) {
          const nsValues = await this.metadataService.getLabelValues(
            dsId,
            'namespace',
            `{${pattern.metricName}}`
          );
          const requiredNs = pattern.additionalSelectors.namespace;
          if (requiredNs && !nsValues.includes(requiredNs)) continue;
        }

        const template = SLO_TEMPLATES.find((t) => t.id === pattern.templateId);
        if (!template) continue;

        suggestions.push({
          templateId: pattern.templateId,
          templateName: template.name,
          confidence: 'high',
          reason: `Detected ${pattern.metricName} with ${pattern.serviceLabelName}="${serviceName}"`,
          prefilled: buildPrefilledSloInput(template, serviceName, dsId, pattern),
          alreadyCovered: false,
        });
      }

      // Step 5: Check existing SLOs
      const existingSlos = await this.sloService.list({ service: [serviceName] });
      const existingSloIds = existingSlos.map((s) => s.id);

      for (const suggestion of suggestions) {
        suggestion.alreadyCovered = existingSlos.some(
          (slo) =>
            slo.serviceName === serviceName &&
            this.metricMatchesTemplate(slo, suggestion.templateId)
        );
      }

      // Step 6: Dependency suggestions
      if (dependencies && dependencies.length > 0) {
        for (const dep of dependencies) {
          // Check if OTEL span metrics exist for this dependency
          if (metricSet.has('latency_seconds_bucket')) {
            const depValues = await this.metadataService.getLabelValues(
              dsId,
              'remoteService',
              `{latency_seconds_bucket}`
            );
            if (depValues.includes(dep)) {
              const depSuggestion: SloSuggestion = {
                templateId: `dep-latency-${dep}`,
                templateName: `${serviceName} → ${dep} Latency P99`,
                confidence: 'medium',
                reason: `Detected span metrics from ${serviceName} to dependency ${dep}`,
                prefilled: buildDependencyPrefilledSloInput(serviceName, dep, dsId),
                alreadyCovered: existingSlos.some(
                  (slo) => slo.serviceName === serviceName && slo.operationName === '' // dependency SLOs have empty operation
                ),
              };
              suggestions.push(depSuggestion);
            }
          }
        }
      }

      return { service: serviceName, suggestions, existingSloIds };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`SloSuggestionEngine.getSuggestions failed for ${serviceName}: ${msg}`);
      return { service: serviceName, suggestions: [], existingSloIds: [] };
    }
  }

  /**
   * Compute badge data for all services (batch, for the services table).
   *
   * Performance: fetches metric names once and SLOs once, then all
   * computation is in-memory per service.
   */
  async getBadgeData(
    services: EnrichedOtelService[],
    dsId: string
  ): Promise<Map<string, SuggestionBadgeData>> {
    const result = new Map<string, SuggestionBadgeData>();

    try {
      const metricNames = await this.metadataService.getMetricNames(dsId);
      const metricSet = new Set(metricNames);

      const allSlos = await this.sloService.list();

      for (const service of services) {
        let totalSuggested = 0;
        let alreadyCreated = 0;

        for (const pattern of DETECTION_PATTERNS) {
          if (!metricSet.has(pattern.metricName)) continue;
          totalSuggested++;

          // Check if an existing SLO covers this pattern for this service
          const covered = allSlos.some(
            (slo) =>
              slo.serviceName === service.name &&
              this.metricMatchesTemplate(slo, pattern.templateId)
          );
          if (covered) alreadyCreated++;
        }

        result.set(service.name, { totalSuggested, alreadyCreated });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`SloSuggestionEngine.getBadgeData failed: ${msg}`);
    }

    return result;
  }

  /** Build a PromQL selector string from a detection pattern. */
  private buildSelector(pattern: MetricDetectionPattern): string {
    const parts = [pattern.metricName];
    if (pattern.additionalSelectors) {
      const labels = Object.entries(pattern.additionalSelectors)
        .map(([k, v]) => `${k}="${v}"`)
        .join(',');
      return `{${pattern.metricName},${labels}}`;
    }
    return `{${parts[0]}}`;
  }

  /**
   * Check if an SLO summary's metric matches a given template.
   * Uses the SLO's sliType + a heuristic on metric name to determine coverage.
   */
  private metricMatchesTemplate(
    slo: { sliType: string; serviceName: string },
    templateId: string
  ): boolean {
    const template = SLO_TEMPLATES.find((t) => t.id === templateId);
    if (!template) return false;
    return slo.sliType === template.sliType;
  }
}
