/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { OtelServiceDiscoveryService } from '../otel_service_discovery';
import type { OtelService, OtelSignals, OtelServiceDiscoveryProvider, Logger } from '../types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockLogger: Logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

const mockServices: OtelService[] = [
  {
    name: 'api-gateway',
    environment: 'production',
    type: 'Service',
    sdkLanguage: 'java',
    dependencies: ['payment-service'],
    lastSeen: new Date().toISOString(),
  },
  {
    name: 'payment-service',
    environment: 'production',
    type: 'Service',
    sdkLanguage: 'go',
    dependencies: [],
    lastSeen: new Date().toISOString(),
  },
];

const mockSignals: OtelSignals = { hasTraces: true, hasLogs: true, hasMetrics: true };

function createMockProvider(
  services: OtelService[] = mockServices,
  signals: OtelSignals = mockSignals
): OtelServiceDiscoveryProvider {
  return {
    discoverServices: jest.fn().mockResolvedValue(services),
    getAvailableSignals: jest.fn().mockResolvedValue(signals),
  };
}

function createMockSloService(slos: Array<{ serviceName: string; budget?: number }> = []) {
  return {
    list: jest.fn().mockResolvedValue(
      slos.map((s, i) => ({
        id: `slo-${i}`,
        name: `SLO ${i}`,
        serviceName: s.serviceName,
        status: { errorBudgetRemaining: s.budget },
      }))
    ),
  } as any;
}

function createMockAlertService(alerts: Array<{ service?: string; state: string }> = []) {
  return {
    getUnifiedAlerts: jest.fn().mockResolvedValue({
      results: alerts.map((a, i) => ({
        id: `alert-${i}`,
        state: a.state,
        labels: a.service ? { service: a.service } : {},
      })),
    }),
  } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OtelServiceDiscoveryService', () => {
  it('returns enriched services with SLO and alert counts', async () => {
    const provider = createMockProvider();
    const sloService = createMockSloService([
      { serviceName: 'api-gateway', budget: 0.42 },
      { serviceName: 'api-gateway', budget: 0.85 },
    ]);
    const alertService = createMockAlertService([
      { service: 'api-gateway', state: 'active' },
      { service: 'api-gateway', state: 'active' },
      { service: 'payment-service', state: 'active' },
      { service: 'unknown-service', state: 'active' },
    ]);

    const service = new OtelServiceDiscoveryService(provider, sloService, alertService, mockLogger);

    const result = await service.listServices();

    expect(result).toHaveLength(2);

    const apiGw = result.find((s) => s.name === 'api-gateway')!;
    expect(apiGw.sloCount).toBe(2);
    expect(apiGw.activeAlertCount).toBe(2);
    expect(apiGw.worstErrorBudget).toBe(0.42);
    expect(apiGw.signals).toEqual(mockSignals);

    const payment = result.find((s) => s.name === 'payment-service')!;
    expect(payment.sloCount).toBe(0);
    expect(payment.activeAlertCount).toBe(1);
    expect(payment.worstErrorBudget).toBeUndefined();
  });

  it('returns empty array when provider discovers no services', async () => {
    const provider = createMockProvider([]);
    const service = new OtelServiceDiscoveryService(
      provider,
      createMockSloService(),
      createMockAlertService(),
      mockLogger
    );

    const result = await service.listServices();
    expect(result).toEqual([]);
  });

  it('handles SLO service failure gracefully', async () => {
    const provider = createMockProvider();
    const sloService = { list: jest.fn().mockRejectedValue(new Error('SLO store down')) } as any;
    const alertService = createMockAlertService();

    const service = new OtelServiceDiscoveryService(provider, sloService, alertService, mockLogger);

    const result = await service.listServices();
    expect(result).toHaveLength(2);
    expect(result[0].sloCount).toBe(0); // graceful degradation
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('failed to fetch SLOs'));
  });

  it('handles alert service failure gracefully', async () => {
    const provider = createMockProvider();
    const sloService = createMockSloService();
    const alertService = {
      getUnifiedAlerts: jest.fn().mockRejectedValue(new Error('network error')),
    } as any;

    const service = new OtelServiceDiscoveryService(provider, sloService, alertService, mockLogger);

    const result = await service.listServices();
    expect(result).toHaveLength(2);
    expect(result[0].activeAlertCount).toBe(0);
  });

  it('getService returns a single service by name', async () => {
    const provider = createMockProvider();
    const service = new OtelServiceDiscoveryService(
      provider,
      createMockSloService(),
      createMockAlertService(),
      mockLogger
    );

    const result = await service.getService('api-gateway');
    expect(result).toBeDefined();
    expect(result!.name).toBe('api-gateway');
  });

  it('getService returns null for unknown service', async () => {
    const provider = createMockProvider();
    const service = new OtelServiceDiscoveryService(
      provider,
      createMockSloService(),
      createMockAlertService(),
      mockLogger
    );

    const result = await service.getService('nonexistent');
    expect(result).toBeNull();
  });

  it('only counts active/pending alerts, not resolved', async () => {
    const provider = createMockProvider();
    const alertService = createMockAlertService([
      { service: 'api-gateway', state: 'active' },
      { service: 'api-gateway', state: 'resolved' },
      { service: 'api-gateway', state: 'pending' },
    ]);

    const service = new OtelServiceDiscoveryService(
      provider,
      createMockSloService(),
      alertService,
      mockLogger
    );

    const result = await service.listServices();
    const apiGw = result.find((s) => s.name === 'api-gateway')!;
    expect(apiGw.activeAlertCount).toBe(2); // active + pending, not resolved
  });

  it('works with undefined sloService', async () => {
    const provider = createMockProvider();
    const service = new OtelServiceDiscoveryService(
      provider,
      undefined,
      createMockAlertService(),
      mockLogger
    );

    const result = await service.listServices();
    expect(result).toHaveLength(2);
    expect(result[0].sloCount).toBe(0);
  });

  it('caches service discovery results', async () => {
    const provider = createMockProvider();
    const service = new OtelServiceDiscoveryService(
      provider,
      createMockSloService(),
      createMockAlertService(),
      mockLogger
    );

    await service.listServices();
    await service.listServices();

    // Provider should only be called once (cached)
    expect(provider.discoverServices).toHaveBeenCalledTimes(1);
  });
});
