/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * REST API handlers for cross-service incident grouping (Phase 6.4).
 * Framework-agnostic: returns { status, body } objects.
 */

import type { OtelServiceDiscoveryService } from '../../common/otel_service_discovery';
import type { Logger } from '../../common/types';
import { buildTopologyGraph, extractActiveIncidents } from '../../common/topology_service';
import { groupIncidents } from '../../common/incident_grouping_service';
import type { HandlerResult } from './route_utils';

export async function handleGetGroupedIncidents(
  otelService: OtelServiceDiscoveryService,
  logger?: Logger
): Promise<HandlerResult> {
  try {
    const services = await otelService.listServices();
    const graph = buildTopologyGraph(services);
    const incidents = extractActiveIncidents(graph);
    const groups = groupIncidents(incidents, graph);

    // Incidents not part of any multi-service group
    const groupedServiceNames = new Set<string>();
    for (const g of groups) {
      if (g.incidents.length > 1) {
        for (const inc of g.incidents) groupedServiceNames.add(inc.serviceName);
      }
    }
    const ungrouped = incidents.filter((i) => !groupedServiceNames.has(i.serviceName));

    return {
      status: 200,
      body: { groups, ungrouped },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (logger) logger.warn(`handleGetGroupedIncidents failed: ${msg}`);
    return {
      status: 503,
      body: {
        error: 'Incident grouping temporarily unavailable',
        message: msg,
      },
    };
  }
}
