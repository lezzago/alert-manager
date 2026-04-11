/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Types for the SLO Suggestion Engine (Phase 2).
 *
 * The suggestion engine analyzes discovered OTEL services against available
 * Prometheus metrics to recommend SLOs with pre-filled configurations.
 * These types are shared across the engine (common/), API (server/), and UI (public/).
 */

import type { SloInput } from './slo_types';

/** Confidence level for a suggestion based on metric availability. */
export type SuggestionConfidence = 'high' | 'medium' | 'low';

/** A single SLO suggestion for a service. */
export interface SloSuggestion {
  /** ID of the SloTemplate this suggestion derives from (e.g. 'http-availability'). */
  templateId: string;
  /** Human-readable template name (e.g. 'HTTP Availability'). */
  templateName: string;
  /** Confidence in the suggestion based on metric availability. */
  confidence: SuggestionConfidence;
  /** Human-readable reason explaining why this SLO is suggested. */
  reason: string;
  /** Fully pre-filled SloInput ready for one-click creation. */
  prefilled: SloInput;
  /** Whether an existing SLO already covers this template+service combination. */
  alreadyCovered: boolean;
}

/** Response from GET /api/alerting/services/{name}/slo-suggestions. */
export interface SloSuggestionsResponse {
  service: string;
  suggestions: SloSuggestion[];
  /** IDs of existing SLOs for this service (for dimming covered suggestions). */
  existingSloIds: string[];
}

/** Summary badge data for the services table — "X of Y suggested SLOs created". */
export interface SuggestionBadgeData {
  totalSuggested: number;
  alreadyCreated: number;
}

/**
 * A metric detection pattern used by the suggestion engine to identify
 * which SLO templates are applicable for a given service.
 */
export interface MetricDetectionPattern {
  /** Unique pattern ID (maps to template). */
  id: string;
  /** The metric name to search for in the datasource. */
  metricName: string;
  /** Label name used to scope metrics to a specific service. */
  serviceLabelName: string;
  /** Optional additional label selectors (e.g. namespace="span_derived"). */
  additionalSelectors?: Record<string, string>;
  /** The template ID to use when this pattern is detected. */
  templateId: string;
  /** Default SLO target for suggestions (as decimal, e.g. 0.999). */
  defaultTarget: number;
  /** Default window duration for suggestions (e.g. '7d'). */
  defaultWindow: string;
  /** Default latency threshold in seconds (latency templates only). */
  defaultLatencyThreshold?: number;
}
