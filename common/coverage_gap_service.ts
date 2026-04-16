/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Coverage Gaps Report (Phase 6.1).
 *
 * Pure functions that analyze service inventory vs existing SLOs/alerts
 * to identify observability gaps. No I/O — operates on enriched service data.
 */

import type { EnrichedOtelService } from './types';
import type {
  CoverageGapReport,
  ServiceCoverageGap,
  CoverageGapSeverity,
} from './root_cause_types';

// ============================================================================
// Gap severity computation
// ============================================================================

/**
 * Compute gap severity for a single service.
 *
 * - high: has signals (traces/logs/metrics) but no SLOs AND no alerts
 * - medium: has SLOs but missing signal types, OR has alerts but no SLOs
 * - low: minor gaps (e.g., some uncovered dependencies)
 * - none: fully covered
 */
export function computeGapSeverity(
  hasSlos: boolean,
  hasAlerts: boolean,
  hasSignals: boolean,
  uncoveredSignalCount: number,
  uncoveredDependencyCount: number
): CoverageGapSeverity {
  // Service has signals but zero observability coverage
  if (hasSignals && !hasSlos && !hasAlerts) return 'high';

  // Has alerts but no SLOs — alerts without SLO context are hard to triage
  if (hasAlerts && !hasSlos) return 'medium';

  // Has SLOs but missing signal coverage
  if (hasSlos && uncoveredSignalCount > 0) return 'medium';

  // Minor: some uncovered dependencies
  if (uncoveredDependencyCount > 0) return 'low';

  // No signals at all (maybe a database stub) — nothing to cover
  if (!hasSignals && !hasSlos && !hasAlerts) return 'low';

  return 'none';
}

// ============================================================================
// Main report function
// ============================================================================

/**
 * Compute coverage gaps across all discovered services.
 *
 * Uses enrichment data already present on EnrichedOtelService (sloCount,
 * activeAlertCount, signals) — no additional API calls needed.
 */
export function computeCoverageGaps(services: EnrichedOtelService[]): CoverageGapReport {
  if (services.length === 0) {
    return {
      totalServices: 0,
      servicesWithSlos: 0,
      servicesWithAlerts: 0,
      servicesWithoutAnyCoverage: 0,
      sloCoveragePercent: 0,
      alertCoveragePercent: 0,
      gaps: [],
      computedAt: new Date().toISOString(),
    };
  }

  // Build a set of all service names that have SLOs for dependency checks
  const servicesWithSloSet = new Set<string>();
  for (const svc of services) {
    if (svc.sloCount > 0) servicesWithSloSet.add(svc.name);
  }

  const gaps: ServiceCoverageGap[] = [];
  let servicesWithSlos = 0;
  let servicesWithAlerts = 0;
  let servicesWithoutAnyCoverage = 0;

  for (const svc of services) {
    const hasSlos = svc.sloCount > 0;
    const hasAlerts = svc.activeAlertCount > 0;
    const hasTraces = svc.signals?.hasTraces ?? false;
    const hasLogs = svc.signals?.hasLogs ?? false;
    const hasMetrics = svc.signals?.hasMetrics ?? false;
    const hasSignals = hasTraces || hasLogs || hasMetrics;

    if (hasSlos) servicesWithSlos++;
    if (hasAlerts) servicesWithAlerts++;

    // Uncovered signals: signals present but no SLO covering them
    const uncoveredSignals: Array<'traces' | 'logs' | 'metrics'> = [];
    if (!hasSlos) {
      if (hasTraces) uncoveredSignals.push('traces');
      if (hasLogs) uncoveredSignals.push('logs');
      if (hasMetrics) uncoveredSignals.push('metrics');
    }

    // Uncovered dependencies: deps of this service that have no SLOs
    const uncoveredDependencies = svc.dependencies.filter((dep) => !servicesWithSloSet.has(dep));

    const gapSeverity = computeGapSeverity(
      hasSlos,
      hasAlerts,
      hasSignals,
      uncoveredSignals.length,
      uncoveredDependencies.length
    );

    if (!hasSlos && !hasAlerts) servicesWithoutAnyCoverage++;

    gaps.push({
      serviceName: svc.name,
      hasSlos,
      sloCount: svc.sloCount,
      hasAlerts,
      alertCount: svc.activeAlertCount,
      hasTraces,
      hasLogs,
      hasMetrics,
      uncoveredSignals,
      uncoveredDependencies,
      gapSeverity,
    });
  }

  // Sort by severity: high first, then medium, low, none
  const severityOrder: Record<CoverageGapSeverity, number> = {
    high: 0,
    medium: 1,
    low: 2,
    none: 3,
  };
  gaps.sort((a, b) => severityOrder[a.gapSeverity] - severityOrder[b.gapSeverity]);

  return {
    totalServices: services.length,
    servicesWithSlos,
    servicesWithAlerts,
    servicesWithoutAnyCoverage,
    sloCoveragePercent: Math.round((servicesWithSlos / services.length) * 100),
    alertCoveragePercent: Math.round((servicesWithAlerts / services.length) * 100),
    gaps,
    computedAt: new Date().toISOString(),
  };
}
