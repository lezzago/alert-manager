/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * REST API handlers for root cause analysis (Phase 6.2).
 * Framework-agnostic: returns { status, body } objects.
 */

import type { RootCauseAnalysisService } from '../../common/root_cause_analysis_service';
import type { OtelServiceDiscoveryService } from '../../common/otel_service_discovery';
import type { UnifiedAlertSummary, Logger } from '../../common/types';
import type { HandlerResult } from './route_utils';

export async function handleGetRootCauseAnalysis(
  rcaService: RootCauseAnalysisService,
  otelService: OtelServiceDiscoveryService,
  alert: UnifiedAlertSummary,
  sloQuery?: string,
  datasourceId?: string,
  logger?: Logger
): Promise<HandlerResult> {
  try {
    const services = await otelService.listServices();
    const result = await rcaService.analyze(alert, services, sloQuery, datasourceId);
    return { status: 200, body: result };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (logger) logger.warn(`handleGetRootCauseAnalysis failed: ${msg}`);
    return {
      status: 200,
      body: {
        alertId: alert.id,
        serviceName: alert.labels?.service ?? '',
        narrative: 'Root cause analysis temporarily unavailable.',
        confidence: 'low',
        evidence: [],
        rootService: null,
        dependencyAlerts: [],
        suggestedActions: [],
        computedAt: new Date().toISOString(),
      },
    };
  }
}
