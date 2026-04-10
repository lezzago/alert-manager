/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  handleListServices,
  handleGetService,
  handleGetApmConfig,
} from '../routes/service_handlers';
import type { Logger } from '../../common/types';

const mockLogger: Logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

const mockEnrichedService = {
  name: 'api-gateway',
  environment: 'production',
  type: 'Service',
  sdkLanguage: 'java',
  dependencies: ['payment-service'],
  lastSeen: new Date().toISOString(),
  sloCount: 2,
  activeAlertCount: 1,
  worstErrorBudget: 0.85,
  signals: { hasTraces: true, hasLogs: true, hasMetrics: true },
};

describe('service_handlers', () => {
  describe('handleListServices', () => {
    it('returns services with total count', async () => {
      const service = {
        listServices: jest.fn().mockResolvedValue([mockEnrichedService]),
      } as any;

      const result = await handleListServices(service, mockLogger);
      expect(result.status).toBe(200);
      expect(result.body.services).toHaveLength(1);
      expect(result.body.total).toBe(1);
    });

    it('returns empty list on error (graceful degradation)', async () => {
      const service = {
        listServices: jest.fn().mockRejectedValue(new Error('index not found')),
      } as any;

      const result = await handleListServices(service, mockLogger);
      expect(result.status).toBe(200);
      expect(result.body.services).toEqual([]);
      expect(result.body.total).toBe(0);
    });
  });

  describe('handleGetService', () => {
    it('returns a single service', async () => {
      const service = {
        getService: jest.fn().mockResolvedValue(mockEnrichedService),
      } as any;

      const result = await handleGetService(service, 'api-gateway', mockLogger);
      expect(result.status).toBe(200);
      expect(result.body.name).toBe('api-gateway');
    });

    it('returns 404 for unknown service', async () => {
      const service = {
        getService: jest.fn().mockResolvedValue(null),
      } as any;

      const result = await handleGetService(service, 'nonexistent', mockLogger);
      expect(result.status).toBe(404);
      expect(result.body.error).toContain('nonexistent');
    });
  });

  describe('handleGetApmConfig', () => {
    it('returns configured:false when no repository', async () => {
      const reader = { getConfig: jest.fn() } as any;
      const result = await handleGetApmConfig(reader, undefined, mockLogger);
      expect(result.status).toBe(200);
      expect(result.body.configured).toBe(false);
    });

    it('returns config when APM is configured', async () => {
      const mockConfig = {
        tracesDataset: { id: 'traces', title: 'traces' },
        windowDuration: 60,
      };
      const reader = {
        getConfig: jest.fn().mockResolvedValue(mockConfig),
      } as any;
      const repo = {} as any;

      const result = await handleGetApmConfig(reader, repo, mockLogger);
      expect(result.status).toBe(200);
      expect(result.body.configured).toBe(true);
      expect(result.body.tracesDataset).toEqual({ id: 'traces', title: 'traces' });
    });

    it('returns configured:false when no APM config found', async () => {
      const reader = { getConfig: jest.fn().mockResolvedValue(null) } as any;
      const repo = {} as any;

      const result = await handleGetApmConfig(reader, repo, mockLogger);
      expect(result.status).toBe(200);
      expect(result.body.configured).toBe(false);
    });
  });
});
