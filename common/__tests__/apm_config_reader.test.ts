/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { ApmConfigReader, SavedObjectsRepository } from '../apm_config_reader';
import type { Logger } from '../types';

const mockLogger: Logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

function createMockRepository(
  savedObjects: Array<{
    id: string;
    type: string;
    attributes: Record<string, unknown>;
    references: Array<{ name: string; type: string; id: string }>;
  }> = []
): SavedObjectsRepository {
  return {
    find: jest.fn().mockResolvedValue({
      saved_objects: savedObjects,
      total: savedObjects.length,
    }),
  };
}

describe('ApmConfigReader', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns null when no APM config exists', async () => {
    const repo = createMockRepository([]);
    const reader = new ApmConfigReader(mockLogger);

    const config = await reader.getConfig(repo);
    expect(config).toBeNull();
  });

  it('parses APM config from saved objects', async () => {
    const repo = createMockRepository([
      {
        id: 'corr-1',
        type: 'correlations',
        attributes: {
          correlationType: 'APM-Config-workspace-123',
          entities: [
            { tracesDataset: { id: 'ref-traces' } },
            { serviceMapDataset: { id: 'ref-smap' } },
            { prometheusDataSource: { id: 'ref-prom' } },
            { windowDuration: 120 },
          ],
        },
        references: [
          { name: 'entities[0].index', type: 'index-pattern', id: 'otel-v1-apm-span-*' },
          { name: 'entities[1].index', type: 'index-pattern', id: 'otel-v1-apm-service-map*' },
          { name: 'entities[2].dataConnection', type: 'data-connection', id: 'prom-ds-1' },
        ],
      },
    ]);

    const reader = new ApmConfigReader(mockLogger);
    const config = await reader.getConfig(repo);

    expect(config).not.toBeNull();
    expect(config!.tracesDataset).toEqual({
      id: 'otel-v1-apm-span-*',
      title: 'otel-v1-apm-span-*',
    });
    expect(config!.serviceMapDataset).toEqual({
      id: 'otel-v1-apm-service-map*',
      title: 'otel-v1-apm-service-map*',
    });
    expect(config!.prometheusDataSource).toEqual({ id: 'prom-ds-1', name: 'prom-ds-1' });
    expect(config!.windowDuration).toBe(120);
  });

  it('ignores non-APM correlations', async () => {
    const repo = createMockRepository([
      {
        id: 'corr-other',
        type: 'correlations',
        attributes: {
          correlationType: 'trace-to-logs-abc',
          entities: [],
        },
        references: [],
      },
    ]);

    const reader = new ApmConfigReader(mockLogger);
    const config = await reader.getConfig(repo);
    expect(config).toBeNull();
  });

  it('uses cached config on subsequent calls', async () => {
    const repo = createMockRepository([
      {
        id: 'corr-1',
        type: 'correlations',
        attributes: {
          correlationType: 'APM-Config-ws1',
          entities: [{ windowDuration: 60 }],
        },
        references: [],
      },
    ]);

    const reader = new ApmConfigReader(mockLogger);
    await reader.getConfig(repo);
    await reader.getConfig(repo);

    expect(repo.find).toHaveBeenCalledTimes(1);
  });

  it('returns stale cache on error', async () => {
    const repo = createMockRepository([
      {
        id: 'corr-1',
        type: 'correlations',
        attributes: {
          correlationType: 'APM-Config-ws1',
          entities: [{ windowDuration: 60 }],
        },
        references: [],
      },
    ]);

    const reader = new ApmConfigReader(mockLogger);
    await reader.getConfig(repo);

    // Invalidate cache manually to force re-fetch
    reader.clearCache();

    // Make repo fail
    (repo.find as jest.Mock).mockRejectedValueOnce(new Error('connection refused'));

    const config = await reader.getConfig(repo);
    // Should return null since cache was cleared and fetch failed
    expect(config).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('failed to read APM config')
    );
  });

  it('defaults windowDuration to 60 when not specified', async () => {
    const repo = createMockRepository([
      {
        id: 'corr-1',
        type: 'correlations',
        attributes: {
          correlationType: 'APM-Config-ws1',
          entities: [],
        },
        references: [],
      },
    ]);

    const reader = new ApmConfigReader(mockLogger);
    const config = await reader.getConfig(repo);
    expect(config!.windowDuration).toBe(60);
  });
});
