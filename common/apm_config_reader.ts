/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Reads APM dataset configuration from the observability plugin's saved objects.
 * The APM plugin stores its config as `correlations` saved objects with
 * `correlationType` starting with `APM-Config-`. This reader extracts
 * dataset references (traces, service map, Prometheus) for cross-signal correlation.
 *
 * Only used in OSD mode — standalone mode has no saved objects.
 */

import type { ApmDatasetConfig, Logger } from './types';

const APM_CONFIG_PREFIX = 'APM-Config-';
const CACHE_TTL_MS = 5 * 60_000; // 5 minutes

/**
 * Minimal saved-objects repository interface — avoids importing OSD server types
 * in common/ (which must stay framework-agnostic).
 */
export interface SavedObjectsRepository {
  find<T = unknown>(options: {
    type: string;
    perPage?: number;
    search?: string;
    searchFields?: string[];
  }): Promise<{
    saved_objects: Array<{
      id: string;
      type: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      attributes: Record<string, any>;
      references: Array<{ name: string; type: string; id: string }>;
    }>;
    total: number;
  }>;
}

interface CacheEntry {
  config: ApmDatasetConfig | null;
  fetchedAt: number;
}

export class ApmConfigReader {
  private cache?: CacheEntry;
  private readonly logger?: Logger;

  constructor(logger?: Logger) {
    this.logger = logger;
  }

  /**
   * Fetch the APM dataset configuration. Returns null if the observability
   * plugin is not installed or no APM config has been created.
   */
  async getConfig(repository: SavedObjectsRepository): Promise<ApmDatasetConfig | null> {
    // Serve from cache if still fresh
    if (this.cache && Date.now() - this.cache.fetchedAt < CACHE_TTL_MS) {
      return this.cache.config;
    }

    try {
      const response = await repository.find<Record<string, unknown>>({
        type: 'correlations',
        perPage: 100,
      });

      const apmConfigObj = response.saved_objects.find((obj) => {
        const ct = obj.attributes?.correlationType;
        return typeof ct === 'string' && ct.startsWith(APM_CONFIG_PREFIX);
      });

      if (!apmConfigObj) {
        this.cache = { config: null, fetchedAt: Date.now() };
        return null;
      }

      const config = this.parseConfig(apmConfigObj);
      this.cache = { config, fetchedAt: Date.now() };
      return config;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger?.warn(`ApmConfigReader: failed to read APM config: ${msg}`);
      // Return stale cache if available, otherwise null
      return this.cache?.config ?? null;
    }
  }

  /** Invalidate the cache (e.g. when user changes APM config). */
  clearCache(): void {
    this.cache = undefined;
  }

  private parseConfig(obj: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    attributes: Record<string, any>;
    references: Array<{ name: string; type: string; id: string }>;
  }): ApmDatasetConfig {
    const refs = obj.references ?? [];
    const entities: unknown[] = Array.isArray(obj.attributes?.entities)
      ? obj.attributes.entities
      : [];

    // APM config stores references with names like 'entities[0].index', 'entities[2].dataConnection'
    const tracesRef = refs.find((r) => r.name === 'entities[0].index');
    const serviceMapRef = refs.find((r) => r.name === 'entities[1].index');
    const promRef = refs.find((r) => r.name === 'entities[2].dataConnection');

    // Extract window duration from entities
    let windowDuration = 60;
    for (const entity of entities) {
      if (entity && typeof entity === 'object' && 'windowDuration' in entity) {
        const wd = (entity as { windowDuration: unknown }).windowDuration;
        if (typeof wd === 'number' && wd > 0) {
          windowDuration = wd;
        }
      }
    }

    // Find correlated log datasets (trace-to-logs correlations)
    const logDatasets: Array<{ id: string; title: string }> = [];
    for (const ref of refs) {
      if (ref.name.startsWith('entities[') && ref.type === 'index-pattern') {
        // Skip traces and service map datasets — those are entities[0] and entities[1]
        if (ref.name === 'entities[0].index' || ref.name === 'entities[1].index') continue;
        logDatasets.push({ id: ref.id, title: ref.id });
      }
    }

    return {
      tracesDataset: tracesRef ? { id: tracesRef.id, title: tracesRef.id } : undefined,
      serviceMapDataset: serviceMapRef
        ? { id: serviceMapRef.id, title: serviceMapRef.id }
        : undefined,
      prometheusDataSource: promRef ? { id: promRef.id, name: promRef.id } : undefined,
      logDatasets: logDatasets.length > 0 ? logDatasets : undefined,
      windowDuration,
    };
  }
}
