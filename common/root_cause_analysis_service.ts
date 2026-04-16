/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Root Cause Analysis Service (Phase 6.2).
 *
 * Orchestrates correlation data, topology analysis, and narrative synthesis
 * to produce a human-readable root cause analysis for a firing alert.
 *
 * Does NOT use LLMs — produces template-based narratives from structured data.
 */

import type { AlertCorrelationService } from './alert_correlation_service';
import type {
  AlertCorrelationResult,
  EnrichedOtelService,
  FailureMode,
  Logger,
  UnifiedAlertSummary,
} from './types';
import type {
  RootCauseAnalysis,
  RootCauseEvidence,
  DependencyAlertInfo,
  RootCauseConfidence,
} from './root_cause_types';
import { buildTopologyGraph, computeHealthLevel } from './topology_service';

/** Maximum dependency services to correlate (avoids fan-out). */
const MAX_DEPENDENCY_CORRELATIONS = 3;

/** Cache TTL for RCA results. */
const CACHE_TTL_MS = 2 * 60_000;

interface CacheEntry {
  result: RootCauseAnalysis;
  fetchedAt: number;
}

export class RootCauseAnalysisService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly correlationService: AlertCorrelationService,
    private readonly logger: Logger
  ) {}

  /**
   * Perform root cause analysis for a firing alert.
   *
   * Steps:
   * 1. Fetch correlations for the alert's service
   * 2. Build topology and find alerting dependencies
   * 3. Fetch correlations for alerting dependencies (top N)
   * 4. Synthesize narrative from failure modes + dependency context
   */
  async analyze(
    alert: UnifiedAlertSummary,
    services: EnrichedOtelService[],
    sloQuery?: string,
    datasourceId?: string
  ): Promise<RootCauseAnalysis> {
    const serviceName = alert.labels?.service;
    if (!serviceName) {
      return this.emptyAnalysis(alert.id, '');
    }

    // Check cache
    const cacheKey = `${alert.id}:${serviceName}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.result;
    }

    try {
      // Step 1: Get correlations for the alert's service
      const correlation = await this.correlationService.getCorrelations(
        alert,
        sloQuery,
        datasourceId
      );

      // Step 2: Build topology and find alerting dependencies
      const graph = buildTopologyGraph(services);
      const serviceNode = graph.nodes.find((n) => n.id === serviceName);
      const service = serviceNode?.service;

      // Find dependencies that also have active alerts
      const alertingDeps: DependencyAlertInfo[] = [];
      if (service) {
        for (const depName of service.dependencies) {
          const depNode = graph.nodes.find((n) => n.id === depName);
          if (depNode && depNode.service.activeAlertCount > 0) {
            alertingDeps.push({
              serviceName: depName,
              alertCount: depNode.service.activeAlertCount,
              health: computeHealthLevel(depNode.service),
              failureModes: [],
            });
          }
        }
      }

      // Step 3: Fetch correlations for top alerting dependencies
      const depCorrelations = new Map<string, AlertCorrelationResult>();
      const depsToCorrelate = alertingDeps.slice(0, MAX_DEPENDENCY_CORRELATIONS);

      for (const dep of depsToCorrelate) {
        try {
          // Create a synthetic alert for the dependency service
          const depAlert: UnifiedAlertSummary = {
            ...alert,
            id: `${alert.id}-dep-${dep.serviceName}`,
            labels: { ...alert.labels, service: dep.serviceName },
          };
          const depCorr = await this.correlationService.getCorrelations(depAlert);
          depCorrelations.set(dep.serviceName, depCorr);
          dep.failureModes = depCorr.failureModes;
        } catch (err) {
          this.logger.warn(
            `RCA: Failed to correlate dependency ${dep.serviceName}: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
      }

      // Step 4: Synthesize analysis
      const evidence = this.buildEvidence(serviceName, correlation, alertingDeps, services);
      const rootService = this.identifyRootService(serviceName, alertingDeps, depCorrelations);
      const confidence = this.computeConfidence(correlation, alertingDeps, depCorrelations);
      const narrative = this.synthesizeNarrative(
        serviceName,
        correlation,
        alertingDeps,
        rootService,
        depCorrelations
      );
      const suggestedActions = this.buildSuggestedActions(
        serviceName,
        correlation,
        alertingDeps,
        rootService
      );

      const result: RootCauseAnalysis = {
        alertId: alert.id,
        serviceName,
        narrative,
        confidence,
        evidence,
        rootService,
        dependencyAlerts: alertingDeps,
        suggestedActions,
        computedAt: new Date().toISOString(),
      };

      this.cache.set(cacheKey, { result, fetchedAt: Date.now() });
      return result;
    } catch (err) {
      this.logger.warn(
        `RCA: Analysis failed for alert ${alert.id}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      return this.emptyAnalysis(alert.id, serviceName);
    }
  }

  clearCache(): void {
    this.cache.clear();
  }

  // --------------------------------------------------------------------------
  // Evidence building
  // --------------------------------------------------------------------------

  private buildEvidence(
    serviceName: string,
    correlation: AlertCorrelationResult,
    alertingDeps: DependencyAlertInfo[],
    services: EnrichedOtelService[]
  ): RootCauseEvidence[] {
    const evidence: RootCauseEvidence[] = [];

    // Failure modes from traces
    for (const fm of correlation.failureModes) {
      evidence.push({
        type: 'failure_mode',
        summary: `${fm.percentage}% of errors: ${fm.pattern}`,
        serviceName,
        reference: fm.exampleTraceIds[0],
      });
    }

    // Dependency alerts
    for (const dep of alertingDeps) {
      evidence.push({
        type: 'dependency_alert',
        summary: `${dep.serviceName} has ${dep.alertCount} firing alert${dep.alertCount > 1 ? 's' : ''} (${dep.health})`,
        serviceName: dep.serviceName,
      });
    }

    // Error logs
    const errorLogCount = correlation.logs.filter(
      (l) => l.severityText === 'ERROR' || l.severityText === 'FATAL'
    ).length;
    if (errorLogCount > 0) {
      evidence.push({
        type: 'error_log',
        summary: `${errorLogCount} error/fatal log entries in the alert window`,
        serviceName,
      });
    }

    // Blast radius
    const svc = services.find((s) => s.name === serviceName);
    if (svc) {
      const upstreamCallers = services.filter((s) => s.dependencies.includes(serviceName));
      if (upstreamCallers.length > 0) {
        evidence.push({
          type: 'blast_radius',
          summary: `${upstreamCallers.length} upstream service${upstreamCallers.length > 1 ? 's' : ''} may be impacted: ${upstreamCallers.map((s) => s.name).join(', ')}`,
          serviceName,
        });
      }
    }

    return evidence;
  }

  // --------------------------------------------------------------------------
  // Root service identification
  // --------------------------------------------------------------------------

  private identifyRootService(
    serviceName: string,
    alertingDeps: DependencyAlertInfo[],
    depCorrelations: Map<string, AlertCorrelationResult>
  ): string | null {
    if (alertingDeps.length === 0) return null;

    // Find the dependency with the strongest failure signal
    let bestDep: string | null = null;
    let bestScore = 0;

    for (const dep of alertingDeps) {
      const depCorr = depCorrelations.get(dep.serviceName);
      let score = dep.alertCount;
      if (depCorr) {
        // More failure modes = stronger signal
        score += depCorr.failureModes.length * 2;
        // Error traces count
        score += Math.min(depCorr.traces.length, 10);
      }
      if (score > bestScore) {
        bestScore = score;
        bestDep = dep.serviceName;
      }
    }

    return bestDep;
  }

  // --------------------------------------------------------------------------
  // Confidence computation
  // --------------------------------------------------------------------------

  private computeConfidence(
    correlation: AlertCorrelationResult,
    alertingDeps: DependencyAlertInfo[],
    depCorrelations: Map<string, AlertCorrelationResult>
  ): RootCauseConfidence {
    let signals = 0;

    // Strong failure modes on the alert's service
    if (correlation.failureModes.length > 0) signals++;

    // Alerting dependencies with matching failure patterns
    if (alertingDeps.length > 0) signals++;

    // Dependency correlations with clear failure modes
    for (const [, depCorr] of depCorrelations) {
      if (depCorr.failureModes.length > 0) {
        signals++;
        break;
      }
    }

    // Error traces available
    if (correlation.traces.length > 0) signals++;

    if (signals >= 3) return 'high';
    if (signals >= 2) return 'medium';
    return 'low';
  }

  // --------------------------------------------------------------------------
  // Narrative synthesis
  // --------------------------------------------------------------------------

  private synthesizeNarrative(
    serviceName: string,
    correlation: AlertCorrelationResult,
    alertingDeps: DependencyAlertInfo[],
    rootService: string | null,
    depCorrelations: Map<string, AlertCorrelationResult>
  ): string {
    const parts: string[] = [];

    // Lead with failure modes
    if (correlation.failureModes.length > 0) {
      const top = correlation.failureModes[0];
      parts.push(`${top.percentage}% of errors on ${serviceName} are "${top.pattern}".`);
    } else if (correlation.traces.length > 0) {
      parts.push(`${correlation.traces.length} error traces detected on ${serviceName}.`);
    } else {
      parts.push(`Alert firing on ${serviceName}.`);
    }

    // Dependency context
    if (rootService && rootService !== serviceName) {
      const depCorr = depCorrelations.get(rootService);
      const depInfo = alertingDeps.find((d) => d.serviceName === rootService);
      if (depInfo) {
        parts.push(
          `Dependency ${rootService} has ${depInfo.alertCount} firing alert${depInfo.alertCount > 1 ? 's' : ''}.`
        );
      }
      if (depCorr && depCorr.failureModes.length > 0) {
        const depTop = depCorr.failureModes[0];
        parts.push(`${rootService} shows "${depTop.pattern}" (${depTop.percentage}% of errors).`);
      }
      parts.push(`${rootService} is likely the root cause — investigate it first.`);
    } else if (alertingDeps.length > 0) {
      const depNames = alertingDeps.map((d) => d.serviceName).join(', ');
      parts.push(`Related dependencies also alerting: ${depNames}.`);
    }

    return parts.join(' ');
  }

  // --------------------------------------------------------------------------
  // Suggested actions
  // --------------------------------------------------------------------------

  private buildSuggestedActions(
    serviceName: string,
    correlation: AlertCorrelationResult,
    alertingDeps: DependencyAlertInfo[],
    rootService: string | null
  ): string[] {
    const actions: string[] = [];

    if (rootService && rootService !== serviceName) {
      actions.push(`Investigate ${rootService} first — it is likely the root cause`);
    }

    if (correlation.failureModes.length > 0) {
      const top = correlation.failureModes[0];
      actions.push(`Check error pattern "${top.pattern}" (${top.count} occurrences)`);
      if (top.exampleTraceIds.length > 0) {
        actions.push(`Examine trace ${top.exampleTraceIds[0]} for detailed call chain`);
      }
    }

    if (correlation.logs.length > 0) {
      actions.push(
        `Review ${correlation.logs.length} correlated log entries for additional context`
      );
    }

    if (alertingDeps.length > 1) {
      actions.push(`Check dependency health: ${alertingDeps.map((d) => d.serviceName).join(', ')}`);
    }

    if (actions.length === 0) {
      actions.push(`Check ${serviceName} logs and recent deployments`);
    }

    return actions;
  }

  // --------------------------------------------------------------------------
  // Empty result
  // --------------------------------------------------------------------------

  private emptyAnalysis(alertId: string, serviceName: string): RootCauseAnalysis {
    return {
      alertId,
      serviceName,
      narrative: serviceName
        ? `Insufficient data to determine root cause for ${serviceName}.`
        : 'Alert does not have a service label — root cause analysis requires a service context.',
      confidence: 'low',
      evidence: [],
      rootService: null,
      dependencyAlerts: [],
      suggestedActions: serviceName
        ? [`Check ${serviceName} logs and metrics manually`]
        : ['Add a "service" label to this alert rule for automatic root cause analysis'],
      computedAt: new Date().toISOString(),
    };
  }
}
