/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * REST API handlers for OTEL service discovery and APM config endpoints.
 * Framework-agnostic: returns { status, body } objects.
 * Follows the same pattern as metadata_handlers.ts.
 */

import type { OtelServiceDiscoveryService } from '../../common/otel_service_discovery';
import type { ApmConfigReader, SavedObjectsRepository } from '../../common/apm_config_reader';
import type { Logger } from '../../common/types';
import type { HandlerResult } from './route_utils';

// --------------------------------------------------------------------------
// List Services
// --------------------------------------------------------------------------

export async function handleListServices(
  service: OtelServiceDiscoveryService,
  logger?: Logger
): Promise<HandlerResult> {
  try {
    const services = await service.listServices();
    return {
      status: 200,
      body: { services, total: services.length },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (logger) logger.warn(`handleListServices failed: ${msg}`);
    return { status: 200, body: { services: [], total: 0 } };
  }
}

// --------------------------------------------------------------------------
// Get Service Detail
// --------------------------------------------------------------------------

export async function handleGetService(
  service: OtelServiceDiscoveryService,
  name: string,
  logger?: Logger
): Promise<HandlerResult> {
  try {
    const svc = await service.getService(name);
    if (!svc) {
      return { status: 404, body: { error: `Service '${name}' not found` } };
    }
    return { status: 200, body: svc };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (logger) logger.warn(`handleGetService failed for ${name}: ${msg}`);
    return { status: 200, body: { error: 'Failed to fetch service details' } };
  }
}

// --------------------------------------------------------------------------
// Get APM Dataset Config
// --------------------------------------------------------------------------

export async function handleGetApmConfig(
  reader: ApmConfigReader,
  repository: SavedObjectsRepository | undefined,
  logger?: Logger
): Promise<HandlerResult> {
  if (!repository) {
    return { status: 200, body: { configured: false } };
  }
  try {
    const config = await reader.getConfig(repository);
    if (!config) {
      return { status: 200, body: { configured: false } };
    }
    return { status: 200, body: { configured: true, ...config } };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (logger) logger.warn(`handleGetApmConfig failed: ${msg}`);
    return { status: 200, body: { configured: false } };
  }
}
