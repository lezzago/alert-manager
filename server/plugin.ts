/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  PluginInitializerContext,
  CoreSetup,
  CoreStart,
  Plugin,
  Logger,
} from 'opensearch-dashboards/server';

import { AlarmsPluginSetup, AlarmsPluginStart } from './types';
import { defineRoutes } from './routes';
import {
  InMemoryDatasourceService,
  MultiBackendAlertService,
  HttpOpenSearchBackend,
  DirectQueryPrometheusBackend,
  SloService,
  SuppressionRuleService,
  Logger as AlarmsLogger,
  PrometheusMetadataProvider,
  OtelServiceDiscoveryService,
  ApmConfigReader,
  OpenSearchOtelProvider,
} from '../common';
import { MockOpenSearchBackend, MockPrometheusBackend, MockOtelProvider } from '../common/testing';
import { PrometheusMetadataService } from '../common/prometheus_metadata_service';
import { SavedObjectSloStore } from './slo_saved_object_store';
import { HttpClient } from '../common/http_client';
import type { SavedObjectsRepository } from '../common/apm_config_reader';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import yaml from 'js-yaml';

/**
 * Read OpenSearch credentials from the OSD config file (--config argument).
 * Returns { url, username, password } if found, undefined otherwise.
 */
function readOsdConfigCredentials(
  logger: Logger
): { url?: string; username: string; password: string } | undefined {
  try {
    // Find --config arg in process.argv
    const args = process.argv;
    let configPath: string | undefined;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--config' && args[i + 1]) {
        configPath = args[i + 1];
        break;
      }
      if (args[i].startsWith('--config=')) {
        configPath = args[i].split('=')[1];
        break;
      }
    }
    if (!configPath) {
      logger.debug(`alertManager: No --config arg found in argv`);
      return undefined;
    }

    const absPath = resolve(process.cwd(), configPath);
    logger.debug(`alertManager: Reading config from ${absPath}`);
    const raw = readFileSync(absPath, 'utf-8');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- YAML config has dynamic/unknown shape
    const cfg = yaml.load(raw) as Record<string, any>;
    // OSD YAML uses flat dotted keys (e.g. "opensearch.username") not nested objects
    const user = cfg?.['opensearch.username'] ?? cfg?.opensearch?.username;
    const pass = cfg?.['opensearch.password'] ?? cfg?.opensearch?.password;
    if (user && pass) {
      const hosts = cfg['opensearch.hosts'] ?? cfg?.opensearch?.hosts;
      const url = Array.isArray(hosts) && hosts.length > 0 ? hosts[0] : undefined;
      logger.info(`alertManager: Read OpenSearch credentials from config file: ${absPath}`);
      return { url, username: user, password: pass };
    }
  } catch (err: unknown) {
    logger.debug(
      `alertManager: Could not read config file: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
  return undefined;
}

export class AlarmsPlugin implements Plugin<AlarmsPluginSetup, AlarmsPluginStart> {
  private readonly logger: Logger;
  private sloService?: SloService;
  private apmRepository?: SavedObjectsRepository;

  constructor(initializerContext: PluginInitializerContext) {
    this.logger = initializerContext.logger.get();
  }

  public setup(core: CoreSetup) {
    this.logger.debug('alertManager: Setup');
    const router = core.http.createRouter();

    const logger: AlarmsLogger = {
      info: (msg) => this.logger.info(msg),
      warn: (msg) => this.logger.warn(msg),
      error: (msg) => this.logger.error(msg),
      debug: (msg) => this.logger.debug(msg),
    };

    // Register SLO saved object type for persisting SLO definitions
    core.savedObjects.registerType({
      name: 'slo-definition',
      hidden: false,
      namespaceType: 'single',
      mappings: {
        properties: {
          name: { type: 'text' },
          datasourceId: { type: 'keyword' },
          sli: { type: 'object', enabled: false },
          target: { type: 'float' },
          budgetWarningThreshold: { type: 'float' },
          window: { type: 'object', enabled: false },
          burnRates: { type: 'object', enabled: false },
          alarms: { type: 'object', enabled: false },
          exclusionWindows: { type: 'object', enabled: false },
          tags: { type: 'object', enabled: false },
          ruleGroupName: { type: 'keyword' },
          rulerNamespace: { type: 'keyword' },
          generatedRuleNames: { type: 'keyword' },
          version: { type: 'integer' },
          createdAt: { type: 'date' },
          createdBy: { type: 'keyword' },
          updatedAt: { type: 'date' },
          updatedBy: { type: 'keyword' },
        },
      },
    });

    const datasourceService = new InMemoryDatasourceService(logger);
    const alertService = new MultiBackendAlertService(datasourceService, logger);

    // Use mock backends only when explicitly enabled via environment variable.
    // In production (inside OSD), real backends should be registered by the
    // consuming application or configured via opensearch_dashboards.yml.
    const mockMode = process.env.ALERT_MANAGER_MOCK_MODE === 'true';

    // SLO service (always available, mock mode seeds sample data).
    // Starts with InMemorySloStore; upgraded to SavedObjectSloStore in start().
    const sloService = new SloService(logger, mockMode);
    this.sloService = sloService;

    // Resolve OpenSearch URL/auth early — needed by both backend registration and OTEL provider
    let osUrl: string | undefined;
    let osAuth: { username: string; password: string } | undefined;

    if (mockMode) {
      this.logger.info('alertManager: Running in MOCK mode');
      const osBackend = new MockOpenSearchBackend(logger);
      const promBackend = new MockPrometheusBackend(logger);
      alertService.registerOpenSearch(osBackend);
      alertService.registerPrometheus(promBackend);

      datasourceService.seed([
        {
          name: 'Mock OpenSearch',
          type: 'opensearch',
          url: 'http://localhost:9200',
          enabled: true,
        },
        {
          name: 'Mock Prometheus',
          type: 'prometheus',
          url: 'http://localhost:9090',
          enabled: true,
        },
      ]);

      // Seed SLO mock data for Prometheus datasource
      sloService.seed('ds-2').catch((err: unknown) => {
        this.logger.warn(
          `alertManager: Failed to seed SLO mock data: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      });
    } else {
      this.logger.info('alertManager: Running in LIVE mode — register backends via API');

      // Resolve OpenSearch credentials. Priority:
      //  1. Env vars OPENSEARCH_USER / OPENSEARCH_PASSWORD (Docker, CI)
      //  2. OSD config file via --config arg (local dev with `yarn start`)
      //  3. Fallback to admin/admin
      const envUser = process.env.OPENSEARCH_USER;
      const envPass = process.env.OPENSEARCH_PASSWORD;

      if (envUser && envPass) {
        osUrl = process.env.OPENSEARCH_URL || 'https://localhost:9200';
        osAuth = { username: envUser, password: envPass };
      } else {
        const configCreds = readOsdConfigCredentials(this.logger);
        osUrl = process.env.OPENSEARCH_URL || configCreds?.url || 'https://localhost:9200';
        osAuth = configCreds
          ? { username: configCreds.username, password: configCreds.password }
          : { username: 'admin', password: 'admin' };
      }

      const osBackend = new HttpOpenSearchBackend(logger);
      const promBackend = new DirectQueryPrometheusBackend(logger, {
        opensearchUrl: osUrl,
        auth: osAuth,
      });

      alertService.registerOpenSearch(osBackend);
      alertService.registerPrometheus(promBackend);

      // Auto-seed an OpenSearch datasource with auth so HttpOpenSearchBackend
      // can call alerting APIs without relying on env vars
      datasourceService.seed([
        {
          name: 'OpenSearch Cluster',
          type: 'opensearch',
          url: osUrl,
          enabled: true,
          auth: {
            type: 'basic' as const,
            credentials: { username: osAuth.username, password: osAuth.password },
          },
        },
      ]);

      // Auto-discover Prometheus datasources from the OpenSearch SQL plugin
      // (async — runs after setup returns, routes are already registered)
      promBackend
        .discoverDatasources()
        .then(async (discovered) => {
          if (discovered.length > 0) {
            this.logger.info(
              `alertManager: Auto-discovered ${
                discovered.length
              } Prometheus datasource(s): ${discovered.map((d) => d.name).join(', ')}`
            );
            datasourceService.seed(discovered);
            // Set first Prometheus datasource as default for Alertmanager operations
            // After seeding, look up the first Prometheus datasource by type
            const allDs = await datasourceService.list();
            const promDs = allDs.find((d) => d.type === 'prometheus');
            if (promDs) {
              promBackend.setDefaultDatasource(promDs);
              this.logger.info(
                `alertManager: Default Prometheus datasource set to ${promDs.name} (${promDs.id})`
              );
            }
          } else {
            this.logger.warn(
              'alertManager: No Prometheus datasources found in OpenSearch SQL plugin'
            );
          }
        })
        .catch((err: unknown) => {
          this.logger.warn(
            `alertManager: Failed to auto-discover Prometheus datasources: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        });
    }

    const suppressionService = new SuppressionRuleService();

    // Create metadata service if the Prometheus backend supports metadata discovery.
    // Both MockPrometheusBackend and DirectQueryPrometheusBackend implement
    // PrometheusMetadataProvider, so this will work in both mock and live modes.
    let metadataService: PrometheusMetadataService | undefined;
    const promBackendRef = alertService.getPrometheusBackend();
    if (promBackendRef && isMetadataProvider(promBackendRef)) {
      metadataService = new PrometheusMetadataService(promBackendRef, datasourceService, logger);
      this.logger.info('alertManager: PrometheusMetadataService initialized');
    }

    // Create OTEL service discovery — uses mock or live provider depending on mode.
    // In mock mode, MockOtelProvider returns services matching existing mock data.
    // In live mode, OpenSearchOtelProvider queries the otel-v1-apm-service-map* index.
    let otelService: OtelServiceDiscoveryService | undefined;
    const apmConfigReader = new ApmConfigReader(logger);
    try {
      if (mockMode) {
        const otelProvider = new MockOtelProvider();
        otelService = new OtelServiceDiscoveryService(
          otelProvider,
          sloService,
          alertService,
          logger
        );
      } else if (osUrl && osAuth) {
        const httpClient = new HttpClient(logger);
        const otelProvider = new OpenSearchOtelProvider(httpClient, osUrl, osAuth, false, logger);
        otelService = new OtelServiceDiscoveryService(
          otelProvider,
          sloService,
          alertService,
          logger
        );
      }
      if (otelService) {
        this.logger.info(
          `alertManager: OtelServiceDiscoveryService initialized (${mockMode ? 'mock' : 'live'})`
        );
      }
    } catch (err: unknown) {
      this.logger.warn(
        `alertManager: Failed to initialize OtelServiceDiscoveryService: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }

    defineRoutes(
      router,
      datasourceService,
      alertService,
      sloService,
      suppressionService,
      logger,
      metadataService,
      otelService,
      apmConfigReader,
      () => this.apmRepository
    );

    return {};
  }

  public start(core: CoreStart) {
    this.logger.debug('alertManager: Started');

    // Create APM config repository for reading observability plugin's dataset config.
    // Uses 'correlations' type which stores APM-Config-* saved objects.
    try {
      this.apmRepository = core.savedObjects.createInternalRepository([
        'slo-definition',
        'correlations',
      ]) as unknown as SavedObjectsRepository;
      this.logger.debug('alertManager: APM config repository created');
    } catch (err: unknown) {
      this.logger.debug(
        `alertManager: Could not create APM config repository (observability plugin may not be installed): ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }

    // Upgrade SLO storage to saved objects for persistence across restarts.
    // Gracefully falls back to the InMemorySloStore if this fails.
    if (this.sloService) {
      try {
        const repository = core.savedObjects.createInternalRepository(['slo-definition']);
        this.sloService.setStore(new SavedObjectSloStore(repository));
        this.logger.info('alertManager: SLO storage upgraded to SavedObjects');

        // Re-seed if in mock mode — InMemory data was lost during the store swap
        const mockMode = process.env.ALERT_MANAGER_MOCK_MODE === 'true';
        if (mockMode) {
          this.sloService.seed('ds-2').catch((err: unknown) => {
            this.logger.warn(
              `alertManager: Failed to re-seed SLO data after store upgrade: ${
                err instanceof Error ? err.message : String(err)
              }`
            );
          });
        }
      } catch (err: unknown) {
        this.logger.warn(
          `alertManager: Failed to create SavedObjectSloStore, using in-memory fallback: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }

    return {};
  }

  public stop() {}
}

/** Runtime check for PrometheusMetadataProvider interface. */
function isMetadataProvider(obj: unknown): obj is PrometheusMetadataProvider {
  if (!obj || typeof obj !== 'object') return false;
  const candidate = obj as Record<string, unknown>;
  return (
    typeof candidate.getMetricNames === 'function' &&
    typeof candidate.getLabelNames === 'function' &&
    typeof candidate.getLabelValues === 'function' &&
    typeof candidate.getMetricMetadata === 'function'
  );
}
