/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Types for Phase 6: Intelligent Root Cause Suggestions.
 *
 * Covers four sub-features:
 *  6.1 — Coverage Gaps Report
 *  6.2 — Alert-Time Root Cause Suggestion
 *  6.3 — SLO Impact Forecasting
 *  6.4 — Cross-Service Incident Grouping
 */

import type { ServiceHealthLevel } from './topology_types';
import type { FailureMode } from './types';

// ============================================================================
// 6.3 — SLO Impact Forecasting
// ============================================================================

export type ForecastSeverity = 'critical' | 'warning' | 'ok' | 'unknown';

export interface ErrorBudgetForecast {
  sloId: string;
  /** Predicted exhaustion time, null if not exhausting. */
  exhaustionTime: Date | null;
  /** Current burn rate as a multiplier of the sustainable rate (1.0 = sustainable). */
  burnRateMultiplier: number;
  /** Human-readable time remaining (e.g. "2h 30m"), null if not exhausting. */
  timeRemaining: string | null;
  /** Forecast severity based on time to exhaustion. */
  severity: ForecastSeverity;
  /** Whether the budget is already exhausted (errorBudgetRemaining < 0). */
  alreadyExhausted: boolean;
}

// ============================================================================
// 6.1 — Coverage Gaps Report
// ============================================================================

export type CoverageGapSeverity = 'none' | 'low' | 'medium' | 'high';

export interface ServiceCoverageGap {
  serviceName: string;
  hasSlos: boolean;
  sloCount: number;
  hasAlerts: boolean;
  alertCount: number;
  hasTraces: boolean;
  hasLogs: boolean;
  hasMetrics: boolean;
  /** Signals present but without SLO coverage. */
  uncoveredSignals: Array<'traces' | 'logs' | 'metrics'>;
  /** Dependencies of this service that have no SLOs. */
  uncoveredDependencies: string[];
  /** Overall gap severity. */
  gapSeverity: CoverageGapSeverity;
}

export interface CoverageGapReport {
  totalServices: number;
  servicesWithSlos: number;
  servicesWithAlerts: number;
  servicesWithoutAnyCoverage: number;
  /** Percentage of services covered by at least one SLO (0–100). */
  sloCoveragePercent: number;
  /** Percentage of services covered by at least one alert rule (0–100). */
  alertCoveragePercent: number;
  /** Per-service gap analysis, sorted by severity descending. */
  gaps: ServiceCoverageGap[];
  computedAt: string;
}

// ============================================================================
// 6.4 — Cross-Service Incident Grouping
// ============================================================================

export type RootCauseConfidence = 'high' | 'medium' | 'low';

export interface IncidentGroup {
  /** Unique group ID (derived from root service name). */
  id: string;
  /** The root cause service (deepest in dependency chain with alerts). */
  rootService: string;
  /** Health level of the root service. */
  rootHealth: ServiceHealthLevel;
  /** All services affected (including the root). */
  affectedServices: string[];
  /** Total alert count across all grouped services. */
  totalAlertCount: number;
  /** Confidence that these alerts share a root cause. */
  rootCauseConfidence: RootCauseConfidence;
  /** Individual incidents that were grouped. */
  incidents: Array<{
    serviceName: string;
    health: ServiceHealthLevel;
    alertCount: number;
    impactedUpstream: string[];
    worstErrorBudget?: number;
  }>;
}

// ============================================================================
// 6.2 — Alert-Time Root Cause Suggestion
// ============================================================================

export type EvidenceType =
  | 'failure_mode'
  | 'dependency_alert'
  | 'error_log'
  | 'error_budget_burn'
  | 'blast_radius';

export interface RootCauseEvidence {
  type: EvidenceType;
  summary: string;
  /** Source service for this evidence. */
  serviceName: string;
  /** Optional reference (trace ID, log timestamp, etc.). */
  reference?: string;
}

export interface DependencyAlertInfo {
  serviceName: string;
  alertCount: number;
  health: ServiceHealthLevel;
  failureModes: FailureMode[];
}

export interface RootCauseAnalysis {
  alertId: string;
  serviceName: string;
  /** Human-readable narrative explaining the likely root cause. */
  narrative: string;
  /** Confidence level based on available evidence. */
  confidence: RootCauseConfidence;
  /** Structured evidence supporting the analysis. */
  evidence: RootCauseEvidence[];
  /** The likely root service (deepest dependency with failures), null if self. */
  rootService: string | null;
  /** Dependency alerts that may be contributing. */
  dependencyAlerts: DependencyAlertInfo[];
  /** Suggested next steps. */
  suggestedActions: string[];
  computedAt: string;
}
