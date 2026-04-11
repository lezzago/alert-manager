/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { handleServiceHealth } from '../service_health_handlers';
import type { OtelServiceDiscoveryService } from '../../../common/otel_service_discovery';
import type { SloService } from '../../../common/slo_service';

function createMockDiscoveryService(service?: {
  name: string;
  activeAlertCount: number;
}): OtelServiceDiscoveryService {
  return {
    getService: jest.fn().mockResolvedValue(
      service
        ? {
            name: service.name,
            environment: 'production',
            type: 'Service',
            dependencies: [],
            signals: { hasTraces: true, hasLogs: true, hasMetrics: false },
            sdkLanguage: 'java',
            lastSeen: new Date().toISOString(),
            sloCount: 1,
            activeAlertCount: service.activeAlertCount,
          }
        : null
    ),
    listServices: jest.fn().mockResolvedValue([]),
  } as unknown as OtelServiceDiscoveryService;
}

function createMockSloService(
  slos: Array<{
    id: string;
    name: string;
    serviceName?: string;
    tags?: Record<string, string>;
    target: number;
    status: { attainment: number; errorBudgetRemaining: number; status: string };
  }> = []
): SloService {
  return {
    list: jest.fn().mockResolvedValue(slos),
  } as unknown as SloService;
}

describe('handleServiceHealth', () => {
  it('returns service health data', async () => {
    const discovery = createMockDiscoveryService({
      name: 'payment-service',
      activeAlertCount: 3,
    });
    const sloService = createMockSloService([
      {
        id: 'slo-1',
        name: 'payment-availability',
        serviceName: 'payment-service',
        tags: { service: 'payment-service' },
        target: 0.999,
        status: { attainment: 0.995, errorBudgetRemaining: 0.4, status: 'healthy' },
      },
    ]);

    const result = await handleServiceHealth('payment-service', discovery, sloService);
    expect(result.status).toBe(200);
    expect(result.body.serviceName).toBe('payment-service');
    expect(result.body.activeAlertCount).toBe(3);
    expect(result.body.severityBreakdown).toEqual({ total: 3 });
    expect(result.body.slos).toHaveLength(1);
    expect(result.body.slos[0].id).toBe('slo-1');
    expect(result.body.hasSlos).toBe(true);
    expect(result.body.alertManagerUrl).toContain('#/services/payment-service');
  });

  it('returns 404 for unknown service', async () => {
    const discovery = createMockDiscoveryService(undefined);
    const result = await handleServiceHealth('unknown', discovery, undefined);
    expect(result.status).toBe(404);
    expect(result.body.error).toContain('not found');
  });

  it('handles missing SLO service gracefully', async () => {
    const discovery = createMockDiscoveryService({
      name: 'api-gateway',
      activeAlertCount: 0,
    });
    const result = await handleServiceHealth('api-gateway', discovery, undefined);
    expect(result.status).toBe(200);
    expect(result.body.slos).toEqual([]);
    expect(result.body.hasSlos).toBe(false);
    expect(result.body.severityBreakdown).toEqual({});
  });

  it('handles SLO service errors gracefully', async () => {
    const discovery = createMockDiscoveryService({
      name: 'order-service',
      activeAlertCount: 1,
    });
    const sloService = {
      list: jest.fn().mockRejectedValue(new Error('SLO store unavailable')),
    } as unknown as SloService;

    const result = await handleServiceHealth('order-service', discovery, sloService);
    expect(result.status).toBe(200);
    expect(result.body.slos).toEqual([]);
  });

  it('filters SLOs by service name label', async () => {
    const discovery = createMockDiscoveryService({
      name: 'api-gateway',
      activeAlertCount: 0,
    });
    const sloService = createMockSloService([
      {
        id: 'slo-1',
        name: 'api-availability',
        serviceName: 'api-gateway',
        tags: { service: 'api-gateway' },
        target: 0.999,
        status: { attainment: 0.999, errorBudgetRemaining: 1.0, status: 'healthy' },
      },
      {
        id: 'slo-2',
        name: 'payment-latency',
        serviceName: 'payment-service',
        tags: { service: 'payment-service' },
        target: 0.999,
        status: { attainment: 0.99, errorBudgetRemaining: 0.1, status: 'breaching' },
      },
    ]);

    const result = await handleServiceHealth('api-gateway', discovery, sloService);
    expect(result.body.slos).toHaveLength(1);
    expect(result.body.slos[0].name).toBe('api-availability');
  });
});
