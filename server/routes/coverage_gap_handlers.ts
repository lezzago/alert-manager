/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * REST API handlers for coverage gap analysis (Phase 6.1).
 * Framework-agnostic: returns { status, body } objects.
 */

import type { OtelServiceDiscoveryService } from '../../common/otel_service_discovery';
import type { Logger } from '../../common/types';
import { computeCoverageGaps } from '../../common/coverage_gap_service';
import type { HandlerResult } from './route_utils';

export async function handleGetCoverageGaps(
  otelService: OtelServiceDiscoveryService,
  logger?: Logger
): Promise<HandlerResult> {
  try {
    const services = await otelService.listServices();
    const report = computeCoverageGaps(services);
    return { status: 200, body: report };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (logger) logger.warn(`handleGetCoverageGaps failed: ${msg}`);
    return {
      status: 503,
      body: {
        error: 'Coverage gap analysis temporarily unavailable',
        message: msg,
      },
    };
  }
}
