/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * OTEL Service Discovery Service — caching + enrichment layer.
 *
 * Wraps an OtelServiceDiscoveryProvider with stale-while-revalidate caching
 * and cross-references discovered services with SLO and alert data from the
 * Alert Manager to produce EnrichedOtelService objects.
 *
 * Follows the same pattern as PrometheusMetadataService.
 */

import type {
  OtelService,
  OtelSignals,
  OtelServiceDiscoveryProvider,
  EnrichedOtelService,
  Logger,
} from './types';
import type { SloService } from './slo_service';
import type { MultiBackendAlertService } from './alert_service';

// ---------------------------------------------------------------------------
// Cache configuration
// ---------------------------------------------------------------------------

const TTL_SERVICES_MS = 2 * 60_000; // 2 minutes
const TTL_SIGNALS_MS = 5 * 60_000; // 5 minutes

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
  ttlMs: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class OtelServiceDiscoveryService {
  private readonly serviceCache = new Map<string, CacheEntry<unknown>>();
  private readonly refreshing = new Set<string>();

  constructor(
    private readonly provider: OtelServiceDiscoveryProvider,
    private readonly sloService: SloService | undefined,
    private readonly alertService: MultiBackendAlertService,
    private readonly logger: Logger
  ) {}

  /**
   * List all OTEL services enriched with SLO coverage and alert counts.
   * Uses stale-while-revalidate caching.
   */
  async listServices(): Promise<EnrichedOtelService[]> {
    const services = await this.cachedFetch<OtelService[]>('services', TTL_SERVICES_MS, () =>
      this.provider.discoverServices()
    );

    if (services.length === 0) return [];

    // Enrich in parallel: SLO + alert cross-reference + signal detection
    const [sloMap, alertMap] = await Promise.all([this.buildSloMap(), this.buildAlertMap()]);

    const enriched: EnrichedOtelService[] = await Promise.all(
      services.map(async (svc) => {
        const sloInfo = sloMap.get(svc.name);
        const alertCount = alertMap.get(svc.name) ?? 0;
        const signals = await this.getSignals(svc.name);

        return {
          ...svc,
          sloCount: sloInfo?.count ?? 0,
          activeAlertCount: alertCount,
          worstErrorBudget: sloInfo?.worstBudget,
          signals,
        };
      })
    );

    return enriched;
  }

  /** Get a single enriched service by name. */
  async getService(name: string): Promise<EnrichedOtelService | null> {
    const all = await this.listServices();
    return all.find((s) => s.name === name) ?? null;
  }

  // ---------------------------------------------------------------------------
  // Enrichment helpers
  // ---------------------------------------------------------------------------

  private async buildSloMap(): Promise<Map<string, { count: number; worstBudget?: number }>> {
    const map = new Map<string, { count: number; worstBudget?: number }>();
    if (!this.sloService) return map;

    try {
      const slos = await this.sloService.list();
      for (const slo of slos) {
        const serviceName = slo.serviceName;
        if (!serviceName) continue;
        const existing = map.get(serviceName);
        const budget = slo.status?.errorBudgetRemaining;
        if (existing) {
          existing.count++;
          if (budget !== undefined) {
            existing.worstBudget =
              existing.worstBudget === undefined ? budget : Math.min(existing.worstBudget, budget);
          }
        } else {
          map.set(serviceName, { count: 1, worstBudget: budget });
        }
      }
    } catch (err: unknown) {
      this.logger.warn(
        `OtelServiceDiscoveryService: failed to fetch SLOs for enrichment: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
    return map;
  }

  private async buildAlertMap(): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    try {
      const resp = await this.alertService.getUnifiedAlerts({ maxResults: 5000 });
      for (const alert of resp.results) {
        if (alert.state !== 'active' && alert.state !== 'pending') continue;
        const serviceName = alert.labels?.service ?? alert.labels?.['service.name'];
        if (!serviceName) continue;
        map.set(serviceName, (map.get(serviceName) ?? 0) + 1);
      }
    } catch (err: unknown) {
      this.logger.warn(
        `OtelServiceDiscoveryService: failed to fetch alerts for enrichment: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
    return map;
  }

  private async getSignals(serviceName: string): Promise<OtelSignals> {
    return this.cachedFetch<OtelSignals>(`signals:${serviceName}`, TTL_SIGNALS_MS, () =>
      this.provider.getAvailableSignals(serviceName)
    );
  }

  // ---------------------------------------------------------------------------
  // Stale-while-revalidate cache (same pattern as PrometheusMetadataService)
  // ---------------------------------------------------------------------------

  private async cachedFetch<T>(
    cacheKey: string,
    ttlMs: number,
    fetchFn: () => Promise<T>
  ): Promise<T> {
    const entry = this.serviceCache.get(cacheKey) as CacheEntry<T> | undefined;
    const now = Date.now();

    if (entry) {
      const isStale = now - entry.fetchedAt > entry.ttlMs;
      if (isStale && !this.refreshing.has(cacheKey)) {
        // Background refresh — return stale data immediately
        this.refreshing.add(cacheKey);
        fetchFn()
          .then((data) => {
            this.serviceCache.set(cacheKey, { data, fetchedAt: Date.now(), ttlMs });
          })
          .catch((err) => {
            this.logger.warn(
              `OtelServiceDiscoveryService: background refresh failed for ${cacheKey}: ${
                err instanceof Error ? err.message : String(err)
              }`
            );
          })
          .finally(() => {
            this.refreshing.delete(cacheKey);
          });
      }
      return entry.data;
    }

    // Cache miss — must wait
    const data = await fetchFn();
    this.serviceCache.set(cacheKey, { data, fetchedAt: Date.now(), ttlMs });
    return data;
  }
}
