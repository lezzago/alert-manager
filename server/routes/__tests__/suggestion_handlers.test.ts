/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { handleGetSloSuggestions, handleGetServiceBadges } from '../suggestion_handlers';
import type { SloSuggestionEngine } from '../../../common/slo_suggestion_engine';
import type { OtelServiceDiscoveryService } from '../../../common/otel_service_discovery';
import type { Logger } from '../../../common/types';

const logger: Logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

function createMockEngine(
  suggestions = { service: 'test', suggestions: [], existingSloIds: [] as string[] },
  badges = new Map<string, { totalSuggested: number; alreadyCreated: number }>()
): SloSuggestionEngine {
  return {
    getSuggestions: jest.fn().mockResolvedValue(suggestions),
    getBadgeData: jest.fn().mockResolvedValue(badges),
  } as unknown as SloSuggestionEngine;
}

function createMockOtelService(
  service = { name: 'test', dependencies: [] }
): OtelServiceDiscoveryService {
  return {
    getService: jest.fn().mockResolvedValue(service),
    listServices: jest.fn().mockResolvedValue([service]),
  } as unknown as OtelServiceDiscoveryService;
}

describe('handleGetSloSuggestions', () => {
  it('returns 200 with suggestions', async () => {
    const suggestions = {
      service: 'api-gateway',
      suggestions: [{ templateId: 'http-availability', confidence: 'high' }],
      existingSloIds: ['slo-1'],
    };
    const engine = createMockEngine(suggestions);
    const otelService = createMockOtelService({ name: 'api-gateway', dependencies: ['db'] });

    const result = await handleGetSloSuggestions(
      engine,
      otelService,
      'api-gateway',
      'ds-2',
      logger
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual(suggestions);
    expect(engine.getSuggestions).toHaveBeenCalledWith('api-gateway', 'ds-2', ['db']);
  });

  it('passes service dependencies to engine', async () => {
    const engine = createMockEngine();
    const otelService = createMockOtelService({
      name: 'api-gateway',
      dependencies: ['payment-db', 'user-auth'],
    });

    await handleGetSloSuggestions(engine, otelService, 'api-gateway', 'ds-2', logger);

    expect(engine.getSuggestions).toHaveBeenCalledWith('api-gateway', 'ds-2', [
      'payment-db',
      'user-auth',
    ]);
  });

  it('returns empty on error', async () => {
    const engine = {
      getSuggestions: jest.fn().mockRejectedValue(new Error('boom')),
    } as unknown as SloSuggestionEngine;
    const otelService = createMockOtelService();

    const result = await handleGetSloSuggestions(engine, otelService, 'test', 'ds-2', logger);

    expect(result.status).toBe(200);
    expect((result.body as { suggestions: unknown[] }).suggestions).toEqual([]);
  });
});

describe('handleGetServiceBadges', () => {
  it('returns 200 with badges map', async () => {
    const badgeMap = new Map([['api-gateway', { totalSuggested: 3, alreadyCreated: 1 }]]);
    const engine = createMockEngine(undefined, badgeMap);
    const otelService = createMockOtelService();

    const result = await handleGetServiceBadges(engine, otelService, 'ds-2', logger);

    expect(result.status).toBe(200);
    expect((result.body as { badges: Record<string, unknown> }).badges['api-gateway']).toEqual({
      totalSuggested: 3,
      alreadyCreated: 1,
    });
  });

  it('returns empty badges on error', async () => {
    const engine = {
      getBadgeData: jest.fn().mockRejectedValue(new Error('boom')),
    } as unknown as SloSuggestionEngine;
    const otelService = {
      listServices: jest.fn().mockRejectedValue(new Error('boom')),
    } as unknown as OtelServiceDiscoveryService;

    const result = await handleGetServiceBadges(engine, otelService, 'ds-2', logger);

    expect(result.status).toBe(200);
    expect((result.body as { badges: Record<string, unknown> }).badges).toEqual({});
  });
});
