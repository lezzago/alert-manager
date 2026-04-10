/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Single source-of-truth HTTP client for the Alert Manager API.
 *
 * Features:
 *  - Mode-aware paths (OSD `/api/alerting/...` vs standalone `/api/...`)
 *  - Response caching with 30s TTL
 *  - Request deduplication for concurrent calls
 *  - Full CRUD: monitors, suppression rules, alert actions, SLOs
 */
import { Datasource } from '../../common';
import type { SuppressionRuleConfig } from '../../common/suppression';
import type {
  DatasourceWarning,
  PrometheusMetricMetadata,
  UnifiedAlertSummary,
  UnifiedRuleSummary,
  UnifiedAlert,
  UnifiedRule,
  OSMonitor,
  EnrichedOtelService,
  ApmDatasetConfig,
} from '../../common/types';
import type { SloDefinition, SloInput, SloSummary } from '../../common/slo_types';

// ---------------------------------------------------------------------------
// HttpClient interface — implemented by OSD's http service adapter or fetch()
// ---------------------------------------------------------------------------

export interface HttpClient {
  get<T = unknown>(path: string, opts?: { query?: Record<string, string | undefined> }): Promise<T>;
  post<T = unknown>(path: string, body?: unknown): Promise<T>;
  put<T = unknown>(path: string, body?: unknown): Promise<T>;
  delete<T = unknown>(path: string): Promise<T>;
}

// ---------------------------------------------------------------------------
// Shared response types
// ---------------------------------------------------------------------------

export interface PaginatedResponse<T> {
  results: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  warnings?: DatasourceWarning[];
}

// ---------------------------------------------------------------------------
// API response types for endpoints with dynamic shapes
// ---------------------------------------------------------------------------

/** Response from GET /alertmanager/config */
export interface AlertmanagerConfigResponse {
  available: boolean;
  cluster?: {
    status: string;
    peers: Array<{ name: string; address: string }>;
    peerCount: number;
  };
  uptime?: string;
  versionInfo?: Record<string, string>;
  config?: {
    global: Record<string, unknown>;
    route: unknown;
    receivers: Array<{
      name: string;
      integrations: Array<{ type: string; summary: string }>;
    }>;
    inhibitRules: unknown[];
  };
  configParseError?: string;
  raw?: string;
  error?: string;
}

/** Response from POST /alerts/:id/acknowledge */
export interface AcknowledgeAlertResponse {
  id: string;
  state: string;
  result: unknown;
}

/** Response from POST /alerts/:id/silence */
export interface SilenceAlertResponse {
  silenced: boolean;
  suppressionRule: SuppressionRuleConfig;
}

/** Response shape for monitor creation/update */
export interface MonitorResponse {
  id: string;
  [key: string]: unknown;
}

/** Response shape for monitor import */
export interface MonitorImportResponse {
  imported: number;
  total: number;
  results: Array<{ index: number; success: boolean; errors?: string[]; id?: string }>;
}

/** Response shape for monitor export */
export interface MonitorExportResponse {
  monitors: Array<Record<string, unknown>>;
}

/** Response shape for monitor deletion */
export interface MonitorDeleteResponse {
  deleted: boolean;
}

/** Response from GET /suppression-rules */
export interface SuppressionRulesListResponse {
  rules: SuppressionRuleConfig[];
}

/** Input for creating a suppression rule (no id or createdAt). */
export type SuppressionRuleInput = Omit<SuppressionRuleConfig, 'id' | 'createdAt'>;

// ---------------------------------------------------------------------------
// Path configuration
// ---------------------------------------------------------------------------

interface ApiPaths {
  datasources: string;
  alerts: string;
  rules: string;
  slos: string;
  monitors: (dsId: string) => string;
  suppressionRules: string;
  alertmanagerConfig: string;
  acknowledgeAlert: (id: string) => string;
  silenceAlert: (id: string) => string;
  alertDetail: (dsId: string, alertId: string) => string;
  ruleDetail: (dsId: string, ruleId: string) => string;
  metricNames: (dsId: string) => string;
  labelNames: (dsId: string) => string;
  labelValues: (dsId: string, label: string) => string;
  metricMetadata: (dsId: string) => string;
  services: string;
  serviceDetail: (name: string) => string;
  apmConfig: string;
}

const OSD_PATHS: ApiPaths = {
  datasources: '/api/alerting/datasources',
  alerts: '/api/alerting/unified/alerts',
  rules: '/api/alerting/unified/rules',
  slos: '/api/alerting/slos',
  monitors: (dsId) => `/api/alerting/opensearch/${dsId}/monitors`,
  suppressionRules: '/api/alerting/suppression-rules',
  alertmanagerConfig: '/api/alerting/alertmanager/config',
  acknowledgeAlert: (id) => `/api/alerting/alerts/${encodeURIComponent(id)}/acknowledge`,
  silenceAlert: (id) => `/api/alerting/alerts/${encodeURIComponent(id)}/silence`,
  alertDetail: (dsId, alertId) =>
    `/api/alerting/alerts/${encodeURIComponent(dsId)}/${encodeURIComponent(alertId)}`,
  ruleDetail: (dsId, ruleId) =>
    `/api/alerting/rules/${encodeURIComponent(dsId)}/${encodeURIComponent(ruleId)}`,
  metricNames: (dsId) => `/api/alerting/prometheus/${encodeURIComponent(dsId)}/metadata/metrics`,
  labelNames: (dsId) => `/api/alerting/prometheus/${encodeURIComponent(dsId)}/metadata/labels`,
  labelValues: (dsId, label) =>
    `/api/alerting/prometheus/${encodeURIComponent(
      dsId
    )}/metadata/label-values/${encodeURIComponent(label)}`,
  metricMetadata: (dsId) =>
    `/api/alerting/prometheus/${encodeURIComponent(dsId)}/metadata/metric-metadata`,
  services: '/api/alerting/services',
  serviceDetail: (name) => `/api/alerting/services/${encodeURIComponent(name)}`,
  apmConfig: '/api/alerting/apm-config',
};

const STANDALONE_PATHS: ApiPaths = {
  datasources: '/api/datasources',
  alerts: '/api/paginated/alerts',
  rules: '/api/paginated/rules',
  slos: '/api/slos',
  monitors: (_dsId) => '/api/monitors',
  suppressionRules: '/api/suppression-rules',
  alertmanagerConfig: '/api/alertmanager/config',
  acknowledgeAlert: (id) => `/api/alerts/${encodeURIComponent(id)}/acknowledge`,
  silenceAlert: (id) => `/api/alerts/${encodeURIComponent(id)}/silence`,
  alertDetail: (dsId, alertId) =>
    `/api/alerts/${encodeURIComponent(dsId)}/${encodeURIComponent(alertId)}`,
  ruleDetail: (dsId, ruleId) =>
    `/api/rules/${encodeURIComponent(dsId)}/${encodeURIComponent(ruleId)}`,
  metricNames: (dsId) => `/api/datasources/${encodeURIComponent(dsId)}/metadata/metrics`,
  labelNames: (dsId) => `/api/datasources/${encodeURIComponent(dsId)}/metadata/labels`,
  labelValues: (dsId, label) =>
    `/api/datasources/${encodeURIComponent(dsId)}/metadata/label-values/${encodeURIComponent(
      label
    )}`,
  metricMetadata: (dsId) => `/api/datasources/${encodeURIComponent(dsId)}/metadata/metric-metadata`,
  services: '/api/services',
  serviceDetail: (name) => `/api/services/${encodeURIComponent(name)}`,
  apmConfig: '/api/apm-config',
};

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const CACHE_TTL_MS = 30_000;

// ---------------------------------------------------------------------------
// AlarmsApiClient
// ---------------------------------------------------------------------------

export class AlarmsApiClient {
  private readonly paths: ApiPaths;
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly http: HttpClient,
    private readonly mode: 'osd' | 'standalone' = 'osd'
  ) {
    this.paths = mode === 'standalone' ? STANDALONE_PATHS : OSD_PATHS;
  }

  /** Expose raw HTTP client for components that need direct API access. */
  get rawHttp(): HttpClient {
    return this.http;
  }

  // ---- Datasources --------------------------------------------------------

  async listDatasources(): Promise<Datasource[]> {
    const res = await this.cachedGet<{ datasources: Datasource[] }>(this.paths.datasources);
    return res.datasources ?? [];
  }

  async listWorkspaces(dsId: string): Promise<Datasource[]> {
    if (this.mode === 'osd') return []; // auto-discovered server-side
    const res = await this.http.get<{ workspaces: Datasource[] }>(
      `${this.paths.datasources}/${dsId}/workspaces`
    );
    return res.workspaces ?? [];
  }

  // ---- Alerts (paginated) -------------------------------------------------

  async listAlertsPaginated(
    dsIds: string[],
    _page: number,
    pageSize: number
  ): Promise<PaginatedResponse<UnifiedAlertSummary>> {
    const query: Record<string, string> = { maxResults: String(pageSize) };
    if (dsIds.length > 0) query.dsIds = dsIds.join(',');
    const res = await this.http.get<{
      results?: UnifiedAlertSummary[];
      alerts?: UnifiedAlertSummary[];
    }>(this.paths.alerts, this.mode === 'osd' ? { query } : undefined);
    const items = res.results ?? res.alerts ?? [];
    return { results: items, total: items.length, page: 1, pageSize: items.length, hasMore: false };
  }

  // ---- Rules (paginated) --------------------------------------------------

  async listRulesPaginated(
    dsIds: string[],
    _page: number,
    pageSize: number
  ): Promise<PaginatedResponse<UnifiedRuleSummary>> {
    const query: Record<string, string> = { maxResults: String(pageSize) };
    if (dsIds.length > 0) query.dsIds = dsIds.join(',');
    const res = await this.http.get<{
      results?: UnifiedRuleSummary[];
      rules?: UnifiedRuleSummary[];
    }>(this.paths.rules, this.mode === 'osd' ? { query } : undefined);
    const items = res.results ?? res.rules ?? [];
    return { results: items, total: items.length, page: 1, pageSize: items.length, hasMore: false };
  }

  // ---- Monitor CRUD -------------------------------------------------------

  async createMonitor(
    data: Partial<OSMonitor> | Record<string, unknown>,
    dsId = 'ds-1'
  ): Promise<MonitorResponse> {
    return this.http.post<MonitorResponse>(this.paths.monitors(dsId), data);
  }
  async updateMonitor(
    id: string,
    data: Partial<OSMonitor> | Record<string, unknown>,
    dsId = 'ds-1'
  ): Promise<MonitorResponse> {
    return this.http.put<MonitorResponse>(
      `${this.paths.monitors(dsId)}/${encodeURIComponent(id)}`,
      data
    );
  }
  async deleteMonitor(id: string, dsId = 'ds-1'): Promise<MonitorDeleteResponse> {
    return this.http.delete<MonitorDeleteResponse>(
      `${this.paths.monitors(dsId)}/${encodeURIComponent(id)}`
    );
  }
  async importMonitors(
    json: Array<Record<string, unknown>>,
    dsId = 'ds-1'
  ): Promise<MonitorImportResponse> {
    return this.http.post<MonitorImportResponse>(`${this.paths.monitors(dsId)}/import`, json);
  }
  async exportMonitors(dsId = 'ds-1'): Promise<MonitorExportResponse> {
    return this.http.get<MonitorExportResponse>(`${this.paths.monitors(dsId)}/export`);
  }

  // ---- Alertmanager config ------------------------------------------------

  async getAlertmanagerConfig(): Promise<AlertmanagerConfigResponse> {
    return this.http.get<AlertmanagerConfigResponse>(this.paths.alertmanagerConfig);
  }

  // ---- Suppression rules --------------------------------------------------

  async listSuppressionRules(): Promise<SuppressionRulesListResponse> {
    return this.http.get<SuppressionRulesListResponse>(this.paths.suppressionRules);
  }
  async createSuppressionRule(
    data: SuppressionRuleInput | Record<string, unknown>
  ): Promise<SuppressionRuleConfig> {
    return this.http.post<SuppressionRuleConfig>(this.paths.suppressionRules, data);
  }
  async updateSuppressionRule(
    id: string,
    data: Partial<SuppressionRuleConfig> | Record<string, unknown>
  ): Promise<SuppressionRuleConfig> {
    return this.http.put<SuppressionRuleConfig>(
      `${this.paths.suppressionRules}/${encodeURIComponent(id)}`,
      data
    );
  }
  async deleteSuppressionRule(id: string): Promise<MonitorDeleteResponse> {
    return this.http.delete<MonitorDeleteResponse>(
      `${this.paths.suppressionRules}/${encodeURIComponent(id)}`
    );
  }

  // ---- SLO CRUD -----------------------------------------------------------

  async listSlos(): Promise<PaginatedResponse<SloSummary>> {
    return this.http.get(this.paths.slos);
  }
  async getSlo(id: string): Promise<SloDefinition> {
    return this.http.get(`${this.paths.slos}/${encodeURIComponent(id)}`);
  }
  async createSlo(data: SloInput): Promise<SloDefinition> {
    return this.http.post(this.paths.slos, data);
  }
  async deleteSlo(id: string): Promise<{ deleted: boolean; generatedRuleNames: string[] }> {
    return this.http.delete(`${this.paths.slos}/${encodeURIComponent(id)}`);
  }

  // ---- Prometheus Metadata ------------------------------------------------

  async getMetricNames(
    dsId: string,
    search?: string
  ): Promise<{ metrics: string[]; total: number; truncated: boolean }> {
    if (search) {
      // OSD HTTP client double-encodes ? in paths — use { query } option in OSD mode
      if (this.mode === 'osd') {
        return this.http.get(this.paths.metricNames(dsId), { query: { search } });
      }
      const path = `${this.paths.metricNames(dsId)}?search=${encodeURIComponent(search)}`;
      return this.http.get(path);
    }
    return this.cachedGet(this.paths.metricNames(dsId));
  }

  async getLabelNames(dsId: string, metric?: string): Promise<{ labels: string[] }> {
    if (metric && this.mode === 'osd') {
      return this.http.get(this.paths.labelNames(dsId), { query: { metric } });
    }
    const path = metric
      ? `${this.paths.labelNames(dsId)}?metric=${encodeURIComponent(metric)}`
      : this.paths.labelNames(dsId);
    return this.cachedGet(path);
  }

  async getLabelValues(
    dsId: string,
    labelName: string,
    selector?: string
  ): Promise<{ values: string[]; total: number; truncated: boolean }> {
    if (selector && this.mode === 'osd') {
      return this.http.get(this.paths.labelValues(dsId, labelName), { query: { selector } });
    }
    const path = selector
      ? `${this.paths.labelValues(dsId, labelName)}?selector=${encodeURIComponent(selector)}`
      : this.paths.labelValues(dsId, labelName);
    return this.cachedGet(path);
  }

  async getMetricMetadata(dsId: string): Promise<{ metadata: PrometheusMetricMetadata[] }> {
    return this.cachedGet(this.paths.metricMetadata(dsId));
  }

  // ---- Alert actions ------------------------------------------------------

  async acknowledgeAlert(
    id: string,
    datasourceId?: string,
    monitorId?: string
  ): Promise<AcknowledgeAlertResponse> {
    return this.http.post<AcknowledgeAlertResponse>(this.paths.acknowledgeAlert(id), {
      datasourceId,
      monitorId,
    });
  }
  async silenceAlert(id: string, duration?: string): Promise<SilenceAlertResponse> {
    return this.http.post<SilenceAlertResponse>(this.paths.silenceAlert(id), {
      duration: duration || '1h',
    });
  }

  // ---- Detail views (flyouts) ---------------------------------------------

  async getAlertDetail(dsId: string, alertId: string): Promise<UnifiedAlert> {
    return this.http.get<UnifiedAlert>(this.paths.alertDetail(dsId, alertId));
  }

  async getRuleDetail(dsId: string, ruleId: string): Promise<UnifiedRule> {
    return this.http.get<UnifiedRule>(this.paths.ruleDetail(dsId, ruleId));
  }

  // ---- OTEL Services -------------------------------------------------------

  async listServices(): Promise<{ services: EnrichedOtelService[]; total: number }> {
    return this.cachedGet(this.paths.services);
  }

  async getService(name: string): Promise<EnrichedOtelService | null> {
    try {
      return await this.http.get<EnrichedOtelService>(this.paths.serviceDetail(name));
    } catch {
      return null;
    }
  }

  async getApmConfig(): Promise<(ApmDatasetConfig & { configured: boolean }) | null> {
    try {
      return await this.cachedGet(this.paths.apmConfig);
    } catch {
      return null;
    }
  }

  // ---- Cache management ---------------------------------------------------

  invalidateCache(): void {
    this.cache.clear();
  }

  private async cachedGet<T>(path: string): Promise<T> {
    const cached = this.cache.get(path);
    if (cached && cached.expiresAt > Date.now()) return cached.data as T;

    const existing = this.inFlight.get(path);
    if (existing) return existing as Promise<T>;

    const request = this.http
      .get<T>(path)
      .then((data) => {
        this.cache.set(path, { data, expiresAt: Date.now() + CACHE_TTL_MS });
        return data;
      })
      .finally(() => {
        this.inFlight.delete(path);
      });

    this.inFlight.set(path, request);
    return request;
  }
}
