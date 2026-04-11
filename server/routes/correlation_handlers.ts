/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * REST API handlers for alert cross-signal correlation.
 * Framework-agnostic: returns { status, body } objects.
 */

import type { AlertCorrelationService } from '../../common/alert_correlation_service';
import type { UnifiedAlertSummary, Logger } from '../../common/types';
import type { HandlerResult } from './route_utils';

// --------------------------------------------------------------------------
// Get Alert Correlations
// --------------------------------------------------------------------------

export async function handleGetAlertCorrelations(
  correlationService: AlertCorrelationService,
  alert: UnifiedAlertSummary,
  sloQuery?: string,
  datasourceId?: string,
  logger?: Logger
): Promise<HandlerResult> {
  const serviceName = alert.labels?.service;
  if (!serviceName) {
    return {
      status: 200,
      body: {
        alertId: alert.id,
        serviceName: '',
        timeWindow: { start: 0, end: 0 },
        traces: [],
        logs: [],
        metrics: [],
        failureModes: [],
        tracesSampled: false,
      },
    };
  }

  try {
    const result = await correlationService.getCorrelations(alert, sloQuery, datasourceId);
    return { status: 200, body: result };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (logger) logger.warn(`handleGetAlertCorrelations failed for ${alert.id}: ${msg}`);
    return {
      status: 200,
      body: {
        alertId: alert.id,
        serviceName,
        timeWindow: { start: 0, end: 0 },
        traces: [],
        logs: [],
        metrics: [],
        failureModes: [],
        tracesSampled: false,
      },
    };
  }
}
