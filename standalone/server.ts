/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Standalone Express server for the Alert Manager.
 * Supports OpenSearch Alerting and Prometheus/AMP backends with mock mode.
 */
import express from 'express';
import path from 'path';
import {
  InMemoryDatasourceService,
  MultiBackendAlertService,
  HttpOpenSearchBackend,
  DirectQueryPrometheusBackend,
  SuppressionRuleService,
  Logger,
  OpenSearchBackend,
  PrometheusBackend,
} from '../common';
import { MockOpenSearchBackend, MockPrometheusBackend } from '../common/testing';
import {
  handleListDatasources,
  handleGetDatasource,
  handleCreateDatasource,
  handleUpdateDatasource,
  handleDeleteDatasource,
  handleTestDatasource,
  handleGetOSMonitors,
  handleGetOSMonitor,
  handleCreateOSMonitor,
  handleUpdateOSMonitor,
  handleDeleteOSMonitor,
  handleGetOSAlerts,
  handleAcknowledgeOSAlerts,
  handleGetPromRuleGroups,
  handleGetPromAlerts,
  handleGetUnifiedAlerts,
  handleGetUnifiedRules,
  handleGetRuleDetail,
  handleGetAlertDetail,
  handleListWorkspaces,
} from '../server/routes/handlers';
import {
  handleCreateMonitor,
  handleUpdateMonitor,
  handleDeleteMonitor,
  handleImportMonitors,
  handleExportMonitors,
  handleListSuppressionRules,
  handleCreateSuppressionRule,
  handleUpdateSuppressionRule,
  handleDeleteSuppressionRule,
  handleAcknowledgeAlert,
  handleSilenceAlert,
} from '../server/routes/monitor_handlers';
import {
  handleListSLOs,
  handleCreateSLO,
  handleGetSLO,
  handleUpdateSLO,
  handleDeleteSLO,
  handlePreviewSLORules,
  handleGetSLOStatuses,
} from '../server/routes/slo_handlers';
import {
  handleGetMetricNames,
  handleGetLabelNames,
  handleGetLabelValues,
  handleGetMetricMetadata,
} from '../server/routes/metadata_handlers';
import {
  handleGetAlertmanagerAlerts,
  handleGetAlertmanagerSilences,
  handleCreateAlertmanagerSilence,
  handleDeleteAlertmanagerSilence,
  handleGetAlertmanagerStatus,
  handleGetAlertmanagerReceivers,
  handleGetAlertmanagerAlertGroups,
  handleGetAlertmanagerConfig,
} from '../server/routes/alertmanager_handlers';
import { SloService } from '../common/slo_service';
import { PrometheusMetadataService } from '../common/prometheus_metadata_service';
import { OtelServiceDiscoveryService } from '../common/otel_service_discovery';
import { handleListServices, handleGetService } from '../server/routes/service_handlers';
import { handleServiceHealth } from '../server/routes/service_health_handlers';
import type { PrometheusMetadataProvider } from '../common/types';
import { MockOtelProvider, MockCorrelationProvider } from '../common/testing';
import { SloSuggestionEngine } from '../common/slo_suggestion_engine';
import {
  handleGetSloSuggestions,
  handleGetServiceBadges,
} from '../server/routes/suggestion_handlers';
import { AlertCorrelationService } from '../common/alert_correlation_service';
import { handleGetAlertCorrelations } from '../server/routes/correlation_handlers';
import { RootCauseAnalysisService } from '../common/root_cause_analysis_service';
import { handleGetRootCauseAnalysis } from '../server/routes/rca_handlers';
import { handleGetCoverageGaps } from '../server/routes/coverage_gap_handlers';
import { handleGetGroupedIncidents } from '../server/routes/incident_handlers';
import type { UnifiedAlertSummary } from '../common/types';

const PORT = process.env.PORT || 5603;
const MOCK_MODE = process.env.MOCK_MODE === 'true';

// Real backend configuration (used when MOCK_MODE is not 'true')
// All values are read from environment variables with safe defaults.
const OPENSEARCH_URL = process.env.OPENSEARCH_URL || 'https://localhost:9200';
const OPENSEARCH_USERNAME = process.env.OPENSEARCH_USERNAME || 'admin';
const OPENSEARCH_PASSWORD = process.env.OPENSEARCH_PASSWORD || 'My_password_123!@#';

const logger: Logger = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`),
  debug: (msg) => console.debug(`[DEBUG] ${msg}`),
};

// Initialize services
const datasourceService = new InMemoryDatasourceService(logger);
const alertService = new MultiBackendAlertService(datasourceService, logger);

let osBackend: OpenSearchBackend;
let promBackend: PrometheusBackend;

/**
 * Initialize backends. In live mode, auto-discovers Prometheus datasources
 * registered in the OpenSearch SQL plugin — no hardcoded names needed.
 */
async function initBackends(): Promise<void> {
  if (MOCK_MODE) {
    logger.info('Running in MOCK MODE — seeding sample datasources');

    const mockOs = new MockOpenSearchBackend(logger);
    const mockProm = new MockPrometheusBackend(logger);
    osBackend = mockOs;
    promBackend = mockProm;

    datasourceService.seed([
      {
        name: 'OpenSearch Production',
        type: 'opensearch',
        url: 'https://opensearch.example.com:9200',
        enabled: true,
      },
      {
        name: 'Prometheus US-East (AMP)',
        type: 'prometheus',
        url: 'https://aps-workspaces.us-east-1.amazonaws.com/workspaces/ws-xxx',
        enabled: true,
      },
      {
        name: 'OpenSearch Staging',
        type: 'opensearch',
        url: 'https://opensearch-staging.example.com:9200',
        enabled: true,
      },
    ]);

    mockOs.seed('ds-1');
    mockOs.seed('ds-3');
    mockProm.seed('ds-2');

    // Seed SLO data for Prometheus datasource
    await sloService.seed('ds-2');
  } else {
    logger.info('Running in LIVE MODE — connecting to real backends');
    logger.info(`  OpenSearch: ${OPENSEARCH_URL}`);

    osBackend = new HttpOpenSearchBackend(logger);

    // DirectQuery backend handles all Prometheus/Alertmanager API calls via OpenSearch
    const dqBackend = new DirectQueryPrometheusBackend(logger, {
      opensearchUrl: OPENSEARCH_URL,
      auth: { username: OPENSEARCH_USERNAME, password: OPENSEARCH_PASSWORD },
    });
    promBackend = dqBackend;

    // Seed the OpenSearch datasource (always present)
    datasourceService.seed([
      {
        name: 'OpenSearch',
        type: 'opensearch',
        url: OPENSEARCH_URL,
        enabled: true,
        auth: {
          type: 'basic',
          credentials: { username: OPENSEARCH_USERNAME, password: OPENSEARCH_PASSWORD },
        },
      },
    ]);

    // Auto-discover Prometheus datasources registered in the OpenSearch SQL plugin.
    // Each PROMETHEUS connector becomes a datasource entry with directQueryName set.
    logger.info('Discovering Prometheus datasources from OpenSearch SQL plugin...');
    const discovered = await dqBackend.discoverDatasources();

    if (discovered.length > 0) {
      datasourceService.seed(discovered);
      // Set the first discovered datasource as the default for alertmanager operations
      const firstDs = await datasourceService.list();
      const firstProm = firstDs.find((d) => d.type === 'prometheus');
      if (firstProm) {
        dqBackend.setDefaultDatasource(firstProm);
      }
    } else {
      logger.warn(
        'No Prometheus datasources found in OpenSearch SQL plugin. ' +
          'Register one via POST /_plugins/_query/_datasources with connector=PROMETHEUS.'
      );
    }
  }

  alertService.registerOpenSearch(osBackend);
  alertService.registerPrometheus(promBackend);
  datasourceService.setPrometheusBackend(promBackend);

  // Initialize metadata service with the Prometheus backend (if it supports metadata)
  const metadataProvider = promBackend as unknown as PrometheusMetadataProvider;
  if (
    metadataProvider &&
    typeof metadataProvider.getMetricNames === 'function' &&
    typeof metadataProvider.getLabelNames === 'function' &&
    typeof metadataProvider.getLabelValues === 'function' &&
    typeof metadataProvider.getMetricMetadata === 'function'
  ) {
    metadataService = new PrometheusMetadataService(metadataProvider, datasourceService, logger);
    logger.info('PrometheusMetadataService initialized');
  }

  // Initialize OTEL service discovery (mock provider in standalone mode)
  const otelProvider = new MockOtelProvider();
  otelService = new OtelServiceDiscoveryService(otelProvider, sloService, alertService, logger);
  logger.info('OtelServiceDiscoveryService initialized (mock provider)');

  // Initialize SLO suggestion engine if metadata service is available
  if (metadataService) {
    suggestionEngine = new SloSuggestionEngine(metadataService, sloService, logger);
    logger.info('SloSuggestionEngine initialized');
  }

  // Initialize alert correlation service (mock provider in standalone mode)
  const correlationProvider = new MockCorrelationProvider();
  correlationService = new AlertCorrelationService(correlationProvider, logger);
  logger.info('AlertCorrelationService initialized (mock provider)');

  // Initialize root cause analysis service (Phase 6.2)
  rcaService = new RootCauseAnalysisService(correlationService, logger);
  logger.info('RootCauseAnalysisService initialized');
}

// Suppression service
const suppressionService = new SuppressionRuleService();

// SLO service (mockMode aligns with MOCK_MODE env var)
const sloService = new SloService(logger, MOCK_MODE);

// Metadata service — initialized in initBackends() once the backend is known.
// Declared here so routes can reference it; populated before server starts.
let metadataService: PrometheusMetadataService | undefined;
let otelService: OtelServiceDiscoveryService | undefined;
let suggestionEngine: SloSuggestionEngine | undefined;
let correlationService: AlertCorrelationService | undefined;
let rcaService: RootCauseAnalysisService | undefined;

const app = express();
app.use(express.json());

// Serve static React build
// npm (compiled): __dirname = dist/standalone/ → ../public = dist/public/ ✓
// dev (ts-node):  __dirname = standalone/     → dist/public              ✓
import fs from 'fs';
const npmPublicPath = path.join(__dirname, '..', 'public');
const devPublicPath = path.join(__dirname, 'dist', 'public');
const publicPath = fs.existsSync(npmPublicPath + '/index.html') ? npmPublicPath : devPublicPath;
app.use(express.static(publicPath));

// ============================================================================
// Datasource Routes
// ============================================================================

app.get('/api/datasources', async (_req, res) => {
  const r = await handleListDatasources(datasourceService);
  res.status(r.status).json(r.body);
});
app.get('/api/datasources/:id', async (req, res) => {
  const r = await handleGetDatasource(datasourceService, req.params.id);
  res.status(r.status).json(r.body);
});
app.post('/api/datasources', async (req, res) => {
  const r = await handleCreateDatasource(datasourceService, req.body);
  res.status(r.status).json(r.body);
});
app.put('/api/datasources/:id', async (req, res) => {
  const r = await handleUpdateDatasource(datasourceService, req.params.id, req.body);
  res.status(r.status).json(r.body);
});
app.delete('/api/datasources/:id', async (req, res) => {
  const r = await handleDeleteDatasource(datasourceService, req.params.id);
  res.status(r.status).json(r.body);
});
app.post('/api/datasources/:id/test', async (req, res) => {
  const r = await handleTestDatasource(datasourceService, req.params.id);
  res.status(r.status).json(r.body);
});

// ============================================================================
// OpenSearch Alerting Routes (native API shape)
// ============================================================================

app.get('/api/datasources/:dsId/monitors', async (req, res) => {
  const r = await handleGetOSMonitors(alertService, req.params.dsId);
  res.status(r.status).json(r.body);
});
app.get('/api/datasources/:dsId/monitors/:monitorId', async (req, res) => {
  const r = await handleGetOSMonitor(alertService, req.params.dsId, req.params.monitorId);
  res.status(r.status).json(r.body);
});
app.post('/api/datasources/:dsId/monitors', async (req, res) => {
  const r = await handleCreateOSMonitor(alertService, req.params.dsId, req.body);
  res.status(r.status).json(r.body);
});
app.put('/api/datasources/:dsId/monitors/:monitorId', async (req, res) => {
  const r = await handleUpdateOSMonitor(
    alertService,
    req.params.dsId,
    req.params.monitorId,
    req.body
  );
  res.status(r.status).json(r.body);
});
app.delete('/api/datasources/:dsId/monitors/:monitorId', async (req, res) => {
  const r = await handleDeleteOSMonitor(alertService, req.params.dsId, req.params.monitorId);
  res.status(r.status).json(r.body);
});
app.get('/api/datasources/:dsId/alerts', async (req, res) => {
  const r = await handleGetOSAlerts(alertService, req.params.dsId);
  res.status(r.status).json(r.body);
});
app.post('/api/datasources/:dsId/monitors/:monitorId/acknowledge', async (req, res) => {
  const r = await handleAcknowledgeOSAlerts(
    alertService,
    req.params.dsId,
    req.params.monitorId,
    req.body
  );
  res.status(r.status).json(r.body);
});

// ============================================================================
// Prometheus Routes (native API shape)
// ============================================================================

app.get('/api/datasources/:dsId/rules', async (req, res) => {
  const r = await handleGetPromRuleGroups(alertService, req.params.dsId);
  res.status(r.status).json(r.body);
});
app.get('/api/datasources/:dsId/prom-alerts', async (req, res) => {
  const r = await handleGetPromAlerts(alertService, req.params.dsId);
  res.status(r.status).json(r.body);
});

// ============================================================================
// Prometheus Metadata Routes
// ============================================================================

app.get('/api/datasources/:dsId/metadata/metrics', async (req, res) => {
  if (!metadataService) {
    return res.json({ metrics: [], total: 0, truncated: false });
  }
  const search = req.query.search ? String(req.query.search) : undefined;
  const r = await handleGetMetricNames(metadataService, req.params.dsId, search, logger);
  res.status(r.status).json(r.body);
});

app.get('/api/datasources/:dsId/metadata/labels', async (req, res) => {
  if (!metadataService) {
    return res.json({ labels: [] });
  }
  const metric = req.query.metric ? String(req.query.metric) : undefined;
  const r = await handleGetLabelNames(metadataService, req.params.dsId, metric, logger);
  res.status(r.status).json(r.body);
});

app.get('/api/datasources/:dsId/metadata/label-values/:label', async (req, res) => {
  if (!metadataService) {
    return res.json({ values: [], total: 0, truncated: false });
  }
  const selector = req.query.selector ? String(req.query.selector) : undefined;
  const r = await handleGetLabelValues(
    metadataService,
    req.params.dsId,
    req.params.label,
    selector,
    logger
  );
  res.status(r.status).json(r.body);
});

app.get('/api/datasources/:dsId/metadata/metric-metadata', async (req, res) => {
  if (!metadataService) {
    return res.json({ metadata: [] });
  }
  const r = await handleGetMetricMetadata(metadataService, req.params.dsId, logger);
  res.status(r.status).json(r.body);
});

// ============================================================================
// OTEL Service Discovery Routes
// ============================================================================

app.get('/api/services', async (_req, res) => {
  if (!otelService) {
    return res.json({ services: [], total: 0 });
  }
  const r = await handleListServices(otelService, logger);
  res.status(r.status).json(r.body);
});

// Badge route MUST come before /api/services/:name to avoid path shadowing
app.get('/api/services/badges', async (req, res) => {
  if (!suggestionEngine || !otelService) {
    return res.json({ badges: {} });
  }
  const dsId = (req.query.dsId as string) || 'ds-2';
  const r = await handleGetServiceBadges(suggestionEngine, otelService, dsId, logger);
  res.status(r.status).json(r.body);
});

app.get('/api/services/:name/slo-suggestions', async (req, res) => {
  if (!suggestionEngine || !otelService) {
    return res.json({ service: req.params.name, suggestions: [], existingSloIds: [] });
  }
  const dsId = (req.query.dsId as string) || 'ds-2';
  const r = await handleGetSloSuggestions(
    suggestionEngine,
    otelService,
    req.params.name,
    dsId,
    logger
  );
  res.status(r.status).json(r.body);
});

app.get('/api/services/:name/health', async (req, res) => {
  if (!otelService) {
    return res.status(404).json({ error: 'Service discovery not available' });
  }
  const r = await handleServiceHealth(req.params.name, otelService, sloService, logger);
  res.status(r.status).json(r.body);
});

app.get('/api/services/:name', async (req, res) => {
  if (!otelService) {
    return res.status(404).json({ error: 'Service discovery not available' });
  }
  const r = await handleGetService(otelService, req.params.name, logger);
  res.status(r.status).json(r.body);
});

app.get('/api/apm-config', async (_req, res) => {
  // Standalone has no APM config saved objects
  res.json({ configured: false });
});

// ============================================================================
// Alert Correlation Routes
// ============================================================================

app.post('/api/correlations', async (req, res) => {
  if (!correlationService) {
    return res.json({
      alertId: '',
      serviceName: '',
      timeWindow: { start: 0, end: 0 },
      traces: [],
      logs: [],
      metrics: [],
      failureModes: [],
      tracesSampled: false,
    });
  }
  const { alert, sloQuery, datasourceId } = req.body;
  const r = await handleGetAlertCorrelations(
    correlationService,
    alert as UnifiedAlertSummary,
    sloQuery,
    datasourceId,
    logger
  );
  res.status(r.status).json(r.body);
});

// ============================================================================
// Root Cause Analysis Routes (Phase 6)
// ============================================================================

app.post('/api/rca', async (req, res) => {
  if (!rcaService || !otelService) {
    return res.json({
      alertId: '',
      serviceName: '',
      narrative: 'Root cause analysis service not available.',
      confidence: 'low',
      evidence: [],
      rootService: null,
      dependencyAlerts: [],
      suggestedActions: [],
      computedAt: new Date().toISOString(),
    });
  }
  const { alert, sloQuery, datasourceId } = req.body;
  const r = await handleGetRootCauseAnalysis(
    rcaService,
    otelService,
    alert as UnifiedAlertSummary,
    sloQuery,
    datasourceId,
    logger
  );
  res.status(r.status).json(r.body);
});

app.get('/api/coverage-gaps', async (_req, res) => {
  if (!otelService) {
    return res.json({
      totalServices: 0,
      servicesWithSlos: 0,
      servicesWithAlerts: 0,
      servicesWithoutAnyCoverage: 0,
      sloCoveragePercent: 0,
      alertCoveragePercent: 0,
      gaps: [],
      computedAt: new Date().toISOString(),
    });
  }
  const r = await handleGetCoverageGaps(otelService, logger);
  res.status(r.status).json(r.body);
});

app.get('/api/incidents/grouped', async (_req, res) => {
  if (!otelService) {
    return res.json({ groups: [], ungrouped: [] });
  }
  const r = await handleGetGroupedIncidents(otelService, logger);
  res.status(r.status).json(r.body);
});

// ============================================================================
// Prometheus Alertmanager Routes (prom/alertmanager API v2)
// ============================================================================

app.get('/api/alertmanager/alerts', async (_req, res) => {
  const r = await handleGetAlertmanagerAlerts(promBackend);
  res.status(r.status).json(r.body);
});
app.get('/api/alertmanager/silences', async (_req, res) => {
  const r = await handleGetAlertmanagerSilences(promBackend);
  res.status(r.status).json(r.body);
});
app.post('/api/alertmanager/silences', async (req, res) => {
  const r = await handleCreateAlertmanagerSilence(promBackend, req.body);
  res.status(r.status).json(r.body);
});
app.delete('/api/alertmanager/silences/:id', async (req, res) => {
  const r = await handleDeleteAlertmanagerSilence(promBackend, req.params.id);
  res.status(r.status).json(r.body);
});
app.get('/api/alertmanager/status', async (_req, res) => {
  const r = await handleGetAlertmanagerStatus(promBackend);
  res.status(r.status).json(r.body);
});
app.get('/api/alertmanager/receivers', async (_req, res) => {
  const r = await handleGetAlertmanagerReceivers(promBackend);
  res.status(r.status).json(r.body);
});
app.get('/api/alertmanager/alert-groups', async (_req, res) => {
  const r = await handleGetAlertmanagerAlertGroups(promBackend);
  res.status(r.status).json(r.body);
});
app.get('/api/alertmanager/config', async (_req, res) => {
  const r = await handleGetAlertmanagerConfig(promBackend);
  res.status(r.status).json(r.body);
});

// ============================================================================
// Unified Views (cross-backend, for the UI)
// ============================================================================

app.get('/api/alerts', async (req, res) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Express query string type is qs.ParsedQs
  const r = await handleGetUnifiedAlerts(alertService, req.query as any);
  res.status(r.status).json(r.body);
});
app.get('/api/rules', async (req, res) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Express query string type is qs.ParsedQs
  const r = await handleGetUnifiedRules(alertService, req.query as any);
  res.status(r.status).json(r.body);
});

// ============================================================================
// Paginated Unified Views (single-datasource selection)
// ============================================================================

app.get('/api/paginated/rules', async (req, res) => {
  try {
    const dsIds = req.query.dsIds ? String(req.query.dsIds).split(',') : undefined;
    const page = req.query.page ? parseInt(String(req.query.page), 10) : 1;
    const pageSize = req.query.pageSize ? parseInt(String(req.query.pageSize), 10) : 20;
    const result = await alertService.getPaginatedRules({ dsIds, page, pageSize });
    res.json(result);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/paginated/alerts', async (req, res) => {
  try {
    const dsIds = req.query.dsIds ? String(req.query.dsIds).split(',') : undefined;
    const page = req.query.page ? parseInt(String(req.query.page), 10) : 1;
    const pageSize = req.query.pageSize ? parseInt(String(req.query.pageSize), 10) : 20;
    const result = await alertService.getPaginatedAlerts({ dsIds, page, pageSize });
    res.json(result);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ============================================================================
// Workspace Discovery
// ============================================================================

app.get('/api/datasources/:dsId/workspaces', async (req, res) => {
  const r = await handleListWorkspaces(datasourceService, req.params.dsId);
  res.status(r.status).json(r.body);
});

// ============================================================================
// Monitor CRUD Routes
// ============================================================================

app.post('/api/monitors', async (req, res) => {
  const r = await handleCreateMonitor(alertService, req.body);
  res.status(r.status).json(r.body);
});
app.put('/api/monitors/:id', async (req, res) => {
  const r = await handleUpdateMonitor(alertService, req.params.id, req.body);
  res.status(r.status).json(r.body);
});
app.delete('/api/monitors/:id', async (req, res) => {
  const r = await handleDeleteMonitor(alertService, req.params.id, req.query.dsId as string);
  res.status(r.status).json(r.body);
});
app.post('/api/monitors/import', async (req, res) => {
  const r = await handleImportMonitors(alertService, req.body);
  res.status(r.status).json(r.body);
});
app.get('/api/monitors/export', async (_req, res) => {
  const r = await handleExportMonitors(alertService);
  res.status(r.status).json(r.body);
});

// ============================================================================
// Suppression Rules Routes
// ============================================================================

app.get('/api/suppression-rules', (_req, res) => {
  const r = handleListSuppressionRules(suppressionService);
  res.status(r.status).json(r.body);
});
app.post('/api/suppression-rules', (req, res) => {
  const r = handleCreateSuppressionRule(suppressionService, req.body);
  res.status(r.status).json(r.body);
});
app.put('/api/suppression-rules/:id', (req, res) => {
  const r = handleUpdateSuppressionRule(suppressionService, req.params.id, req.body);
  res.status(r.status).json(r.body);
});
app.delete('/api/suppression-rules/:id', (req, res) => {
  const r = handleDeleteSuppressionRule(suppressionService, req.params.id);
  res.status(r.status).json(r.body);
});

// ============================================================================
// Alert Actions Routes
// ============================================================================

app.post('/api/alerts/:id/acknowledge', async (req, res) => {
  const r = await handleAcknowledgeAlert(alertService, req.params.id);
  res.status(r.status).json(r.body);
});
app.post('/api/alerts/:id/silence', async (req, res) => {
  const r = await handleSilenceAlert(suppressionService, req.params.id, req.body);
  res.status(r.status).json(r.body);
});

// ============================================================================
// Detail View Endpoints (on-demand, loaded when user opens flyout)
// ============================================================================

app.get('/api/rules/:dsId/:ruleId', async (req, res) => {
  const r = await handleGetRuleDetail(alertService, req.params.dsId, req.params.ruleId);
  res.status(r.status).json(r.body);
});

app.get('/api/alerts/:dsId/:alertId', async (req, res) => {
  const r = await handleGetAlertDetail(alertService, req.params.dsId, req.params.alertId);
  res.status(r.status).json(r.body);
});

// ============================================================================
// Alertmanager Webhook Receiver
// Receives alert notifications from Prometheus Alertmanager
// ============================================================================

app.post('/api/webhooks/alertmanager', (req, res) => {
  const alerts = req.body?.alerts || [];
  logger.info(`Received ${alerts.length} alert(s) from Alertmanager`);
  for (const alert of alerts) {
    const name = alert.labels?.alertname || 'unknown';
    const status = alert.status || 'unknown';
    logger.info(`  [${status.toUpperCase()}] ${name}`);
  }
  res.json({ status: 'ok' });
});

// ============================================================================
// SLO Routes
// ============================================================================

app.get('/api/slos', async (req, res) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Express query string type is qs.ParsedQs
  const r = await handleListSLOs(sloService, req.query as any, logger);
  res.status(r.status).json(r.body);
});
app.post('/api/slos', async (req, res) => {
  const r = await handleCreateSLO(sloService, req.body, logger);
  res.status(r.status).json(r.body);
});
app.get('/api/slos/statuses', async (req, res) => {
  const ids = req.query.ids ? String(req.query.ids).split(',') : [];
  const r = await handleGetSLOStatuses(sloService, ids, logger);
  res.status(r.status).json(r.body);
});
app.post('/api/slos/preview', async (req, res) => {
  const r = await handlePreviewSLORules(sloService, req.body, logger);
  res.status(r.status).json(r.body);
});
app.get('/api/slos/:id', async (req, res) => {
  const r = await handleGetSLO(sloService, req.params.id, logger);
  res.status(r.status).json(r.body);
});
app.put('/api/slos/:id', async (req, res) => {
  const r = await handleUpdateSLO(sloService, req.params.id, req.body, logger);
  res.status(r.status).json(r.body);
});
app.delete('/api/slos/:id', async (req, res) => {
  const r = await handleDeleteSLO(sloService, req.params.id, logger);
  res.status(r.status).json(r.body);
});

// ============================================================================
// SPA Fallback
// ============================================================================

app.get('*', (_req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// Initialize backends (with auto-discovery) then start the server
initBackends()
  .then(() => {
    app.listen(PORT, () => {
      logger.info(`Alert Manager running at http://localhost:${PORT}`);
      logger.info(`Mock mode: ${MOCK_MODE ? 'ENABLED' : 'DISABLED'}`);
    });
  })
  .catch((err) => {
    logger.error(`Failed to initialize backends: ${err}`);
    process.exit(1);
  });
