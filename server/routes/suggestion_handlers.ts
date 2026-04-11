/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * REST API handlers for SLO suggestion engine endpoints.
 * Framework-agnostic: returns { status, body } objects.
 * Follows the same pattern as service_handlers.ts.
 */

import type { SloSuggestionEngine } from '../../common/slo_suggestion_engine';
import type { OtelServiceDiscoveryService } from '../../common/otel_service_discovery';
import type { Logger } from '../../common/types';
import type { HandlerResult } from './route_utils';

// --------------------------------------------------------------------------
// Get SLO Suggestions for a Service
// --------------------------------------------------------------------------

export async function handleGetSloSuggestions(
  engine: SloSuggestionEngine,
  otelService: OtelServiceDiscoveryService,
  serviceName: string,
  dsId: string,
  logger?: Logger
): Promise<HandlerResult> {
  try {
    const service = await otelService.getService(serviceName);
    const suggestions = await engine.getSuggestions(serviceName, dsId, service?.dependencies);
    return { status: 200, body: suggestions };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (logger) logger.warn(`handleGetSloSuggestions failed for ${serviceName}: ${msg}`);
    return {
      status: 200,
      body: { service: serviceName, suggestions: [], existingSloIds: [] },
    };
  }
}

// --------------------------------------------------------------------------
// Get Badge Data for All Services
// --------------------------------------------------------------------------

export async function handleGetServiceBadges(
  engine: SloSuggestionEngine,
  otelService: OtelServiceDiscoveryService,
  dsId: string,
  logger?: Logger
): Promise<HandlerResult> {
  try {
    const services = await otelService.listServices();
    const badgeMap = await engine.getBadgeData(services, dsId);
    const badges: Record<string, { totalSuggested: number; alreadyCreated: number }> = {};
    for (const [name, data] of badgeMap) {
      badges[name] = data;
    }
    return { status: 200, body: { badges } };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (logger) logger.warn(`handleGetServiceBadges failed: ${msg}`);
    return { status: 200, body: { badges: {} } };
  }
}
