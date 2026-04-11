/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * OSD route adapter — wires framework-agnostic handlers to OSD's IRouter.
 */
import { schema } from '@osd/config-schema';
import { IRouter } from 'opensearch-dashboards/server';
import {
  DatasourceService,
  MultiBackendAlertService,
  SloService,
  SuppressionRuleService,
  Logger,
} from '../../common';
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
} from './handlers';
import {
  handleListSuppressionRules,
  handleCreateSuppressionRule,
  handleUpdateSuppressionRule,
  handleDeleteSuppressionRule,
} from './monitor_handlers';
import {
  handleListSLOs,
  handleCreateSLO,
  handleGetSLO,
  handleUpdateSLO,
  handleDeleteSLO,
  handlePreviewSLORules,
  handleGetSLOStatuses,
} from './slo_handlers';
import {
  handleGetMetricNames,
  handleGetLabelNames,
  handleGetLabelValues,
  handleGetMetricMetadata,
} from './metadata_handlers';
import type { PrometheusMetadataService } from '../../common/prometheus_metadata_service';
import type { OtelServiceDiscoveryService } from '../../common/otel_service_discovery';
import type { ApmConfigReader, SavedObjectsRepository } from '../../common/apm_config_reader';
import { handleGetAlertmanagerConfig } from './alertmanager_handlers';
import { handleListServices, handleGetService, handleGetApmConfig } from './service_handlers';
import { handleGetSloSuggestions, handleGetServiceBadges } from './suggestion_handlers';
import type { SloSuggestionEngine } from '../../common/slo_suggestion_engine';

export function defineRoutes(
  router: IRouter,
  datasourceService: DatasourceService,
  alertService: MultiBackendAlertService,
  sloService?: SloService,
  suppressionService?: SuppressionRuleService,
  logger?: Logger,
  metadataService?: PrometheusMetadataService,
  otelService?: OtelServiceDiscoveryService,
  apmConfigReader?: ApmConfigReader,
  getApmRepository?: () => SavedObjectsRepository | undefined,
  suggestionEngine?: SloSuggestionEngine
) {
  // Datasource routes
  router.get({ path: '/api/alerting/datasources', validate: false }, async (_ctx, _req, res) => {
    const result = await handleListDatasources(datasourceService);
    return res.ok({ body: result.body });
  });

  router.get(
    {
      path: '/api/alerting/datasources/{id}',
      validate: { params: schema.object({ id: schema.string() }) },
    },
    async (_ctx, req, res) => {
      const result = await handleGetDatasource(datasourceService, req.params.id);
      return result.status === 200
        ? res.ok({ body: result.body })
        : res.notFound({ body: result.body });
    }
  );

  router.post(
    {
      path: '/api/alerting/datasources',
      validate: {
        body: schema.object({
          name: schema.string({ minLength: 1, maxLength: 255 }),
          type: schema.oneOf([schema.literal('opensearch'), schema.literal('prometheus')]),
          url: schema.uri({ scheme: ['http', 'https'] }),
          enabled: schema.maybe(schema.boolean()),
        }),
      },
    },
    async (_ctx, req, res) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- validated by @osd/config-schema above
      const result = await handleCreateDatasource(datasourceService, req.body as any);
      return res.ok({ body: result.body });
    }
  );

  router.put(
    {
      path: '/api/alerting/datasources/{id}',
      validate: {
        params: schema.object({ id: schema.string() }),
        body: schema.object({
          name: schema.maybe(schema.string()),
          url: schema.maybe(schema.string()),
          enabled: schema.maybe(schema.boolean()),
        }),
      },
    },
    async (_ctx, req, res) => {
      const result = await handleUpdateDatasource(
        datasourceService,
        req.params.id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- validated by @osd/config-schema above
        req.body as any
      );
      return result.status === 200
        ? res.ok({ body: result.body })
        : res.notFound({ body: result.body });
    }
  );

  router.delete(
    {
      path: '/api/alerting/datasources/{id}',
      validate: { params: schema.object({ id: schema.string() }) },
    },
    async (_ctx, req, res) => {
      const result = await handleDeleteDatasource(datasourceService, req.params.id);
      return result.status === 200
        ? res.ok({ body: result.body })
        : res.notFound({ body: result.body });
    }
  );

  router.post(
    {
      path: '/api/alerting/datasources/{id}/test',
      validate: { params: schema.object({ id: schema.string() }) },
    },
    async (_ctx, req, res) => {
      const result = await handleTestDatasource(datasourceService, req.params.id);
      return res.ok({ body: result.body });
    }
  );

  // Unified view routes
  router.get(
    {
      path: '/api/alerting/unified/alerts',
      validate: {
        query: schema.object({
          dsIds: schema.maybe(schema.string()),
          timeout: schema.maybe(schema.string()),
          maxResults: schema.maybe(schema.string()),
        }),
      },
    },
    async (_ctx, req, res) => {
      const result = await handleGetUnifiedAlerts(alertService, {
        dsIds: req.query.dsIds,
        timeout: req.query.timeout,
        maxResults: req.query.maxResults,
      });
      return res.ok({ body: result.body });
    }
  );

  router.get(
    {
      path: '/api/alerting/unified/rules',
      validate: {
        query: schema.object({
          dsIds: schema.maybe(schema.string()),
          timeout: schema.maybe(schema.string()),
          maxResults: schema.maybe(schema.string()),
        }),
      },
    },
    async (_ctx, req, res) => {
      const result = await handleGetUnifiedRules(alertService, {
        dsIds: req.query.dsIds,
        timeout: req.query.timeout,
        maxResults: req.query.maxResults,
      });
      return res.ok({ body: result.body });
    }
  );

  // OpenSearch monitor/alert routes
  router.get(
    {
      path: '/api/alerting/opensearch/{dsId}/monitors',
      validate: { params: schema.object({ dsId: schema.string() }) },
    },
    async (_ctx, req, res) => {
      const result = await handleGetOSMonitors(alertService, req.params.dsId);
      return result.status === 200
        ? res.ok({ body: result.body })
        : res.badRequest({ body: result.body });
    }
  );

  router.get(
    {
      path: '/api/alerting/opensearch/{dsId}/monitors/{monitorId}',
      validate: { params: schema.object({ dsId: schema.string(), monitorId: schema.string() }) },
    },
    async (_ctx, req, res) => {
      const result = await handleGetOSMonitor(alertService, req.params.dsId, req.params.monitorId);
      return result.status === 200
        ? res.ok({ body: result.body })
        : res.notFound({ body: result.body });
    }
  );

  const monitorBodySchema = schema.object(
    {
      name: schema.string(),
      type: schema.maybe(schema.string()),
      monitor_type: schema.maybe(schema.string()),
      enabled: schema.maybe(schema.boolean()),
      schedule: schema.maybe(schema.any()),
      inputs: schema.maybe(schema.arrayOf(schema.any())),
      triggers: schema.maybe(schema.arrayOf(schema.any())),
    },
    { unknowns: 'allow' }
  );

  router.post(
    {
      path: '/api/alerting/opensearch/{dsId}/monitors',
      validate: { params: schema.object({ dsId: schema.string() }), body: monitorBodySchema },
    },
    async (_ctx, req, res) => {
      const result = await handleCreateOSMonitor(alertService, req.params.dsId, req.body);
      return res.ok({ body: result.body });
    }
  );

  router.put(
    {
      path: '/api/alerting/opensearch/{dsId}/monitors/{monitorId}',
      validate: {
        params: schema.object({ dsId: schema.string(), monitorId: schema.string() }),
        body: monitorBodySchema,
      },
    },
    async (_ctx, req, res) => {
      const result = await handleUpdateOSMonitor(
        alertService,
        req.params.dsId,
        req.params.monitorId,
        req.body
      );
      return result.status === 200
        ? res.ok({ body: result.body })
        : res.notFound({ body: result.body });
    }
  );

  router.delete(
    {
      path: '/api/alerting/opensearch/{dsId}/monitors/{monitorId}',
      validate: { params: schema.object({ dsId: schema.string(), monitorId: schema.string() }) },
    },
    async (_ctx, req, res) => {
      const result = await handleDeleteOSMonitor(
        alertService,
        req.params.dsId,
        req.params.monitorId
      );
      return result.status === 200
        ? res.ok({ body: result.body })
        : res.notFound({ body: result.body });
    }
  );

  router.get(
    {
      path: '/api/alerting/opensearch/{dsId}/alerts',
      validate: { params: schema.object({ dsId: schema.string() }) },
    },
    async (_ctx, req, res) => {
      const result = await handleGetOSAlerts(alertService, req.params.dsId);
      return result.status === 200
        ? res.ok({ body: result.body })
        : res.badRequest({ body: result.body });
    }
  );

  router.post(
    {
      path: '/api/alerting/opensearch/{dsId}/monitors/{monitorId}/acknowledge',
      validate: {
        params: schema.object({ dsId: schema.string(), monitorId: schema.string() }),
        body: schema.object({ alerts: schema.arrayOf(schema.string()) }),
      },
    },
    async (_ctx, req, res) => {
      const result = await handleAcknowledgeOSAlerts(
        alertService,
        req.params.dsId,
        req.params.monitorId,
        req.body
      );
      return res.ok({ body: result.body });
    }
  );

  // Prometheus routes
  router.get(
    {
      path: '/api/alerting/prometheus/{dsId}/rules',
      validate: { params: schema.object({ dsId: schema.string() }) },
    },
    async (_ctx, req, res) => {
      const result = await handleGetPromRuleGroups(alertService, req.params.dsId);
      return result.status === 200
        ? res.ok({ body: result.body })
        : res.badRequest({ body: result.body });
    }
  );

  router.get(
    {
      path: '/api/alerting/prometheus/{dsId}/alerts',
      validate: { params: schema.object({ dsId: schema.string() }) },
    },
    async (_ctx, req, res) => {
      const result = await handleGetPromAlerts(alertService, req.params.dsId);
      return result.status === 200
        ? res.ok({ body: result.body })
        : res.badRequest({ body: result.body });
    }
  );

  // Detail view routes (on-demand, for flyout panels)
  router.get(
    {
      path: '/api/alerting/rules/{dsId}/{ruleId}',
      validate: {
        params: schema.object({ dsId: schema.string(), ruleId: schema.string() }),
      },
    },
    async (_ctx, req, res) => {
      const result = await handleGetRuleDetail(alertService, req.params.dsId, req.params.ruleId);
      return result.status === 200
        ? res.ok({ body: result.body })
        : res.notFound({ body: result.body });
    }
  );

  router.get(
    {
      path: '/api/alerting/alerts/{dsId}/{alertId}',
      validate: {
        params: schema.object({ dsId: schema.string(), alertId: schema.string() }),
      },
    },
    async (_ctx, req, res) => {
      const result = await handleGetAlertDetail(alertService, req.params.dsId, req.params.alertId);
      return result.status === 200
        ? res.ok({ body: result.body })
        : res.notFound({ body: result.body });
    }
  );

  // ===========================================================================
  // Alertmanager Config Route (read-only, fetched via DirectQuery Prometheus)
  // ===========================================================================

  router.get(
    { path: '/api/alerting/alertmanager/config', validate: false },
    async (_ctx, _req, res) => {
      const promBackend = alertService.getPrometheusBackend?.();
      if (!promBackend) {
        return res.ok({ body: { available: false, error: 'Alertmanager not configured' } });
      }
      const result = await handleGetAlertmanagerConfig(promBackend);
      return res.ok({ body: result.body });
    }
  );

  // ===========================================================================
  // Suppression Rules Routes
  // ===========================================================================

  if (suppressionService) {
    router.get(
      { path: '/api/alerting/suppression-rules', validate: false },
      async (_ctx, _req, res) => {
        const result = handleListSuppressionRules(suppressionService);
        return res.ok({ body: result.body });
      }
    );

    router.post(
      {
        path: '/api/alerting/suppression-rules',
        validate: { body: schema.object({}, { unknowns: 'allow' }) },
      },
      async (_ctx, req, res) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- validated by @osd/config-schema above
        const result = handleCreateSuppressionRule(suppressionService, req.body as any);
        return result.status === 201
          ? res.ok({ body: result.body })
          : res.badRequest({ body: result.body });
      }
    );

    router.put(
      {
        path: '/api/alerting/suppression-rules/{id}',
        validate: {
          params: schema.object({ id: schema.string() }),
          body: schema.object({}, { unknowns: 'allow' }),
        },
      },
      async (_ctx, req, res) => {
        const result = handleUpdateSuppressionRule(
          suppressionService,
          req.params.id,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- validated by @osd/config-schema above
          req.body as any
        );
        return result.status === 200
          ? res.ok({ body: result.body })
          : res.notFound({ body: result.body });
      }
    );

    router.delete(
      {
        path: '/api/alerting/suppression-rules/{id}',
        validate: { params: schema.object({ id: schema.string() }) },
      },
      async (_ctx, req, res) => {
        const result = handleDeleteSuppressionRule(suppressionService, req.params.id);
        return result.status === 200
          ? res.ok({ body: result.body })
          : res.notFound({ body: result.body });
      }
    );
  }

  // ===========================================================================
  // Prometheus Metadata Routes
  // ===========================================================================

  if (metadataService) {
    router.get(
      {
        path: '/api/alerting/prometheus/{dsId}/metadata/metrics',
        validate: {
          params: schema.object({ dsId: schema.string() }),
          query: schema.object({ search: schema.maybe(schema.string()) }),
        },
      },
      async (_ctx, req, res) => {
        const result = await handleGetMetricNames(
          metadataService,
          req.params.dsId,
          req.query.search || undefined,
          logger
        );
        return res.ok({ body: result.body });
      }
    );

    router.get(
      {
        path: '/api/alerting/prometheus/{dsId}/metadata/labels',
        validate: {
          params: schema.object({ dsId: schema.string() }),
          query: schema.object({ metric: schema.maybe(schema.string()) }),
        },
      },
      async (_ctx, req, res) => {
        const result = await handleGetLabelNames(
          metadataService,
          req.params.dsId,
          req.query.metric || undefined,
          logger
        );
        return res.ok({ body: result.body });
      }
    );

    router.get(
      {
        path: '/api/alerting/prometheus/{dsId}/metadata/label-values/{label}',
        validate: {
          params: schema.object({ dsId: schema.string(), label: schema.string() }),
          query: schema.object({ selector: schema.maybe(schema.string()) }),
        },
      },
      async (_ctx, req, res) => {
        const result = await handleGetLabelValues(
          metadataService,
          req.params.dsId,
          req.params.label,
          req.query.selector || undefined,
          logger
        );
        return res.ok({ body: result.body });
      }
    );

    router.get(
      {
        path: '/api/alerting/prometheus/{dsId}/metadata/metric-metadata',
        validate: {
          params: schema.object({ dsId: schema.string() }),
        },
      },
      async (_ctx, req, res) => {
        const result = await handleGetMetricMetadata(metadataService, req.params.dsId, logger);
        return res.ok({ body: result.body });
      }
    );
  }

  // ===========================================================================
  // SLO Routes
  // ===========================================================================

  // ----------- Typed schemas for @osd/config-schema validation -------------

  const sliLabelSchema = schema.object({
    labelName: schema.string({ minLength: 1, maxLength: 128 }),
    labelValue: schema.string({ minLength: 1, maxLength: 256 }),
  });

  const burnRateSchema = schema.object({
    shortWindow: schema.string({ minLength: 1 }),
    longWindow: schema.string({ minLength: 1 }),
    burnRateMultiplier: schema.number({ min: 0.01, max: 1000 }),
    severity: schema.oneOf([schema.literal('critical'), schema.literal('warning')]),
    createAlarm: schema.boolean(),
    forDuration: schema.string({ minLength: 1 }),
    notificationChannel: schema.maybe(schema.string()),
  });

  const sloAlarmToggle = schema.object({
    enabled: schema.boolean(),
    notificationChannel: schema.maybe(schema.string()),
  });

  const sloBodySchema = schema.object({
    name: schema.string({ minLength: 1, maxLength: 128 }),
    datasourceId: schema.string({ minLength: 1 }),
    sli: schema.object({
      type: schema.oneOf([
        schema.literal('availability'),
        schema.literal('latency_p99'),
        schema.literal('latency_p90'),
        schema.literal('latency_p50'),
      ]),
      calcMethod: schema.oneOf([schema.literal('good_requests'), schema.literal('good_periods')]),
      sourceType: schema.oneOf([
        schema.literal('service_operation'),
        schema.literal('service_dependency'),
      ]),
      metric: schema.string({ minLength: 1 }),
      goodEventsFilter: schema.maybe(schema.string()),
      latencyThreshold: schema.maybe(schema.number({ min: 0 })),
      service: sliLabelSchema,
      operation: sliLabelSchema,
      dependency: schema.maybe(sliLabelSchema),
      periodLength: schema.maybe(schema.string()),
    }),
    target: schema.number({ min: 0.9, max: 0.9999 }),
    budgetWarningThreshold: schema.number({ min: 0.01, max: 0.99 }),
    window: schema.object({
      type: schema.oneOf([schema.literal('rolling')]),
      duration: schema.string({ minLength: 1 }),
    }),
    burnRates: schema.arrayOf(burnRateSchema),
    alarms: schema.object({
      sliHealth: sloAlarmToggle,
      attainmentBreach: sloAlarmToggle,
      budgetWarning: sloAlarmToggle,
    }),
    exclusionWindows: schema.arrayOf(
      schema.object({
        name: schema.string(),
        schedule: schema.string(),
        duration: schema.string(),
        reason: schema.maybe(schema.string()),
      })
    ),
    tags: schema.recordOf(schema.string(), schema.string()),
  });

  // Partial body for updates — same structure but all optional
  const sloUpdateBodySchema = schema.object({}, { unknowns: 'allow' });

  if (sloService) {
    router.get(
      {
        path: '/api/alerting/slos',
        validate: {
          query: schema.object({
            page: schema.maybe(schema.string()),
            pageSize: schema.maybe(schema.string()),
            datasourceId: schema.maybe(schema.string()),
            status: schema.maybe(schema.string()),
            sliType: schema.maybe(schema.string()),
            service: schema.maybe(schema.string()),
            search: schema.maybe(schema.string()),
          }),
        },
      },
      async (_ctx, req, res) => {
        const query = req.query;
        const result = await handleListSLOs(
          sloService,
          {
            page: query.page || undefined,
            pageSize: query.pageSize || undefined,
            datasourceId: query.datasourceId || undefined,
            status: query.status ? query.status.split(',') : undefined,
            sliType: query.sliType ? query.sliType.split(',') : undefined,
            service: query.service ? query.service.split(',') : undefined,
            search: query.search || undefined,
          },
          logger
        );
        if (result.status >= 400) {
          return res.customError({
            statusCode: result.status,
            body: {
              message: String(
                (result.body as Record<string, unknown>)?.error || 'Failed to list SLOs'
              ),
            },
          });
        }
        return res.ok({ body: result.body });
      }
    );

    router.post(
      {
        path: '/api/alerting/slos',
        validate: { body: sloBodySchema },
      },
      async (_ctx, req, res) => {
        const result = await handleCreateSLO(sloService, req.body, logger);
        if (result.status === 201) return res.ok({ body: result.body });
        const errBody = result.body as Record<string, unknown>;
        return res.badRequest({
          body: {
            message: String(errBody?.error || 'SLO creation failed'),
            attributes: result.body,
          },
        });
      }
    );

    router.get(
      {
        path: '/api/alerting/slos/statuses',
        validate: {
          query: schema.object({ ids: schema.maybe(schema.string()) }),
        },
      },
      async (_ctx, req, res) => {
        const ids = req.query.ids ? String(req.query.ids).split(',') : [];
        const result = await handleGetSLOStatuses(sloService, ids, logger);
        if (result.status >= 400) {
          return res.customError({
            statusCode: result.status,
            body: {
              message: String(
                (result.body as Record<string, unknown>)?.error || 'Failed to get statuses'
              ),
            },
          });
        }
        return res.ok({ body: result.body });
      }
    );

    router.post(
      {
        path: '/api/alerting/slos/preview',
        validate: { body: sloBodySchema },
      },
      async (_ctx, req, res) => {
        const result = await handlePreviewSLORules(sloService, req.body, logger);
        if (result.status >= 400) {
          return res.customError({
            statusCode: result.status,
            body: {
              message: String((result.body as Record<string, unknown>)?.error || 'Preview failed'),
            },
          });
        }
        return res.ok({ body: result.body });
      }
    );

    router.get(
      {
        path: '/api/alerting/slos/{id}',
        validate: { params: schema.object({ id: schema.string() }) },
      },
      async (_ctx, req, res) => {
        const result = await handleGetSLO(sloService, req.params.id, logger);
        if (result.status === 200) return res.ok({ body: result.body });
        return res.notFound({
          body: {
            message: String((result.body as Record<string, unknown>)?.error || 'SLO not found'),
          },
        });
      }
    );

    router.put(
      {
        path: '/api/alerting/slos/{id}',
        validate: {
          params: schema.object({ id: schema.string() }),
          body: sloUpdateBodySchema,
        },
      },
      async (_ctx, req, res) => {
        const result = await handleUpdateSLO(sloService, req.params.id, req.body, logger);
        if (result.status === 200) return res.ok({ body: result.body });
        return res.notFound({
          body: {
            message: String((result.body as Record<string, unknown>)?.error || 'SLO not found'),
          },
        });
      }
    );

    router.delete(
      {
        path: '/api/alerting/slos/{id}',
        validate: { params: schema.object({ id: schema.string() }) },
      },
      async (_ctx, req, res) => {
        const result = await handleDeleteSLO(sloService, req.params.id, logger);
        if (result.status === 200) return res.ok({ body: result.body });
        return res.notFound({
          body: {
            message: String((result.body as Record<string, unknown>)?.error || 'SLO not found'),
          },
        });
      }
    );
  }

  // --------------------------------------------------------------------------
  // OTEL Service Discovery routes (optional — only when provider is available)
  // --------------------------------------------------------------------------

  if (otelService) {
    router.get({ path: '/api/alerting/services', validate: false }, async (_ctx, _req, res) => {
      const result = await handleListServices(otelService, logger);
      return res.ok({ body: result.body });
    });

    // Badge route MUST come before {name} to avoid path shadowing
    if (suggestionEngine) {
      router.get(
        {
          path: '/api/alerting/services/badges',
          validate: {
            query: schema.object({ dsId: schema.maybe(schema.string()) }),
          },
        },
        async (_ctx, req, res) => {
          const dsId = (req.query as { dsId?: string }).dsId || 'ds-2';
          const result = await handleGetServiceBadges(suggestionEngine, otelService, dsId, logger);
          return res.ok({ body: result.body });
        }
      );
    }

    router.get(
      {
        path: '/api/alerting/services/{name}',
        validate: { params: schema.object({ name: schema.string() }) },
      },
      async (_ctx, req, res) => {
        const result = await handleGetService(otelService, req.params.name, logger);
        if (result.status === 200) return res.ok({ body: result.body });
        return res.notFound({
          body: {
            message: String((result.body as Record<string, unknown>)?.error || 'Service not found'),
          },
        });
      }
    );

    // SLO suggestions for a specific service
    if (suggestionEngine) {
      router.get(
        {
          path: '/api/alerting/services/{serviceName}/slo-suggestions',
          validate: {
            params: schema.object({ serviceName: schema.string() }),
            query: schema.object({ dsId: schema.maybe(schema.string()) }),
          },
        },
        async (_ctx, req, res) => {
          const dsId = (req.query as { dsId?: string }).dsId || 'ds-2';
          const result = await handleGetSloSuggestions(
            suggestionEngine,
            otelService,
            req.params.serviceName,
            dsId,
            logger
          );
          return res.ok({ body: result.body });
        }
      );
    }
  }

  if (apmConfigReader) {
    router.get({ path: '/api/alerting/apm-config', validate: false }, async (_ctx, _req, res) => {
      const repository = getApmRepository?.();
      const result = await handleGetApmConfig(apmConfigReader, repository, logger);
      return res.ok({ body: result.body });
    });
  }
}
