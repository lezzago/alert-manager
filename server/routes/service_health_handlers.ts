/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * REST API handler for service health — enables APM -> Alert Manager integration.
 *
 * GET /api/alerting/services/{name}/health
 *
 * Returns active alert count, severity breakdown, SLO summaries, and a deep link
 * URL back to Alert Manager for the service. APM or any external app can call
 * this to display Alert Manager data inline.
 */

import type { OtelServiceDiscoveryService } from '../../common/otel_service_discovery';
import type { SloService } from '../../common/slo_service';
import type { Logger } from '../../common/types';
import type { HandlerResult } from './route_utils';
import { buildHash } from '../../common/deep_links';

export interface ServiceHealthResponse {
  serviceName: string;
  /** Number of active alerts for this service. */
  activeAlertCount: number;
  /** Severity breakdown: { critical: 2, warning: 1, ... } */
  severityBreakdown: Record<string, number>;
  /** SLO summaries for this service. */
  slos: Array<{
    id: string;
    name: string;
    attainment: number;
    target: number;
    errorBudgetRemaining: number;
    status: string;
  }>;
  /** Whether any SLOs exist for this service. */
  hasSlos: boolean;
  /** Deep link hash route to view this service in Alert Manager. */
  alertManagerUrl: string;
}

export async function handleServiceHealth(
  serviceName: string,
  discoveryService: OtelServiceDiscoveryService,
  sloService: SloService | undefined,
  logger?: Logger
): Promise<HandlerResult> {
  try {
    // Get enriched service data (includes alert count from cross-reference)
    const service = await discoveryService.getService(serviceName);
    if (!service) {
      return { status: 404, body: { error: `Service '${serviceName}' not found` } };
    }

    // Build severity breakdown from enriched data
    const severityBreakdown: Record<string, number> = {};
    if (service.activeAlertCount > 0) {
      // The enriched service only has a total count, not per-severity.
      // Put total under 'total' key.
      severityBreakdown.total = service.activeAlertCount;
    }

    // Get SLOs for this service
    const sloSummaries: ServiceHealthResponse['slos'] = [];
    if (sloService) {
      try {
        const allSlos = await sloService.list();
        const serviceSlos = allSlos.filter(
          (s) =>
            s.tags?.service === serviceName ||
            s.serviceName === serviceName ||
            s.name.toLowerCase().includes(serviceName)
        );
        for (const slo of serviceSlos) {
          sloSummaries.push({
            id: slo.id,
            name: slo.name,
            attainment: slo.status?.attainment ?? 0,
            target: slo.target,
            errorBudgetRemaining: slo.status?.errorBudgetRemaining ?? 1,
            status: slo.status?.status ?? 'unknown',
          });
        }
      } catch (err: unknown) {
        if (logger) logger.warn(`Failed to fetch SLOs for service ${serviceName}: ${err}`);
      }
    }

    const response: ServiceHealthResponse = {
      serviceName,
      activeAlertCount: service.activeAlertCount,
      severityBreakdown,
      slos: sloSummaries,
      hasSlos: sloSummaries.length > 0,
      alertManagerUrl: buildHash({ tab: 'services', serviceName }),
    };

    return { status: 200, body: response };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (logger) logger.warn(`handleServiceHealth failed for ${serviceName}: ${msg}`);
    return { status: 500, body: { error: 'Failed to fetch service health' } };
  }
}
