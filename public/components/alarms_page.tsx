/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Alert Manager UI — single-datasource selection with server-side pagination.
 * Prometheus datasources are decomposed into selectable workspaces.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  EuiPage,
  EuiPageBody,
  EuiPageHeader,
  EuiPageHeaderSection,
  EuiTitle,
  EuiSpacer,
  EuiTab,
  EuiTabs,
  EuiCallOut,
  EuiGlobalToastList,
} from '@elastic/eui';
import { Datasource, DatasourceWarning, UnifiedAlert, UnifiedRule } from '../../common';
import { MonitorsTable } from './monitors_table';
import { CreateMonitor, MonitorFormState } from './create_monitor';
import { AlertsDashboard } from './alerts_dashboard';
import { AlertDetailFlyout } from './alert_detail_flyout';
import { NotificationRoutingPanel } from './notification_routing_panel';
import { SuppressionRulesPanel } from './suppression_rules_panel';
import { CreateLogsMonitor, LogsMonitorFormState } from './create_logs_monitor';
import { CreateMetricsMonitor, MetricsMonitorFormState } from './create_metrics_monitor';
import SloListing from './slo_listing';
import { ServicesTab } from './services_tab';
import { AlarmsApiClient, HttpClient } from '../services/alarms_client';
import { NavigationService } from '../services/navigation_service';
import { useHashRouting } from '../hooks/use_hash_routing';

// Re-export for components that import from this file
export { AlarmsApiClient, HttpClient };

// ============================================================================
// Main Page Component
// ============================================================================

interface AlarmsPageProps {
  apiClient: AlarmsApiClient;
  navigationService?: NavigationService;
}

type TabId = 'alerts' | 'rules' | 'routing' | 'suppression' | 'slos' | 'services';

// Fetch a large page from the server so child tables can paginate client-side.
// The child components (AlertsDashboard, MonitorsTable) handle their own
// page-size controls (10/20/50/100 rows per page) over this full dataset.
const DEFAULT_PAGE_SIZE = 1000;

export const AlarmsPage: React.FC<AlarmsPageProps> = ({ apiClient, navigationService }) => {
  const [routeState, routeActions] = useHashRouting();
  const activeTab = routeState.tab as TabId;
  const setActiveTab = routeActions.setTab;
  const [datasources, setDatasources] = useState<Datasource[]>([]);
  const [workspaceOptions, setWorkspaceOptions] = useState<Datasource[]>([]);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(false);
  const [selectedDsIds, setSelectedDsIds] = useState<string[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<Array<{ datasourceName: string; error: string }>>([]);

  // Paginated data
  const [alerts, setAlerts] = useState<UnifiedAlert[]>([]);
  const [alertsTotal, setAlertsTotal] = useState(0);
  const [alertsPage, setAlertsPage] = useState(1);
  const [alertsPageSize] = useState(DEFAULT_PAGE_SIZE);

  const [rules, setRules] = useState<UnifiedRule[]>([]);
  const [rulesTotal, setRulesTotal] = useState(-1); // -1 = not yet loaded
  const [rulesPage, setRulesPage] = useState(1);
  const [rulesPageSize] = useState(DEFAULT_PAGE_SIZE);

  const [deletedRuleIds, setDeletedRuleIds] = useState<Set<string>>(new Set());
  const [showCreateMonitor, setShowCreateMonitor] = useState(false);
  const [createMonitorType, setCreateMonitorType] = useState<
    'logs' | 'prometheus' | 'metrics' | null
  >(null);
  const [selectedAlert, setSelectedAlertRaw] = useState<UnifiedAlert | null>(null);
  const [toasts, setToasts] = useState<
    Array<{ id: string; title: string; color: string; text?: string }>
  >([]);

  // Sync alert selection with hash routing
  const setSelectedAlert = useCallback(
    (alert: UnifiedAlert | null | ((prev: UnifiedAlert | null) => UnifiedAlert | null)) => {
      if (typeof alert === 'function') {
        setSelectedAlertRaw(alert);
      } else if (alert) {
        routeActions.openAlert(alert.datasourceId, alert.id);
        setSelectedAlertRaw(alert);
      } else {
        routeActions.closeAlert();
        setSelectedAlertRaw(null);
      }
    },
    [routeActions]
  );

  // Restore alert detail from hash on mount or back/forward navigation
  useEffect(() => {
    if (routeState.alertDetail && !selectedAlert) {
      const { datasourceId, alertId } = routeState.alertDetail;
      apiClient
        .getAlertDetail(datasourceId, alertId)
        .then((data: UnifiedAlert) => {
          if (data) setSelectedAlertRaw(data);
        })
        .catch(() => {
          // Alert not found — clear the hash
          routeActions.closeAlert();
        });
    } else if (!routeState.alertDetail && selectedAlert) {
      setSelectedAlertRaw(null);
    }
    // Only react to routeState changes, not selectedAlert
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeState.alertDetail, apiClient, routeActions]);

  const addToast = (
    title: string,
    color: 'success' | 'danger' | 'warning' = 'success',
    text?: string
  ) => {
    setToasts((prev) => [...prev, { id: String(Date.now()), title, color, text }]);
  };

  const visibleRules = rules.filter((r) => !deletedRuleIds.has(r.id));

  // All selectable datasources for the create form: non-prometheus + workspace entries
  const creatableDatasources = useMemo(() => {
    const result: Datasource[] = [];
    for (const ds of datasources) {
      if (ds.type !== 'prometheus') {
        result.push(ds);
      }
    }
    // Add workspace-scoped entries for Prometheus
    for (const ws of workspaceOptions) {
      result.push(ws);
    }
    return result;
  }, [datasources, workspaceOptions]);

  // ---- Load datasources and discover workspaces on mount ----

  useEffect(() => {
    (async () => {
      try {
        const ds = await apiClient.listDatasources();
        setDatasources(ds || []);

        // Discover workspaces for all Prometheus datasources
        const promDs = (ds || []).filter((d) => d.type === 'prometheus');
        const nonPromIds = (ds || []).filter((d) => d.type !== 'prometheus').map((d) => d.id);

        if (promDs.length > 0) {
          setLoadingWorkspaces(true);
          const allWs: Datasource[] = [];
          for (const pds of promDs) {
            try {
              const ws = await apiClient.listWorkspaces(pds.id);
              allWs.push(...ws);
            } catch (e: unknown) {
              addToast(
                'Failed to discover workspaces',
                'warning',
                e instanceof Error ? e.message : String(e)
              );
            }
          }
          setWorkspaceOptions(allWs);
          setLoadingWorkspaces(false);

          // Auto-select all datasources: non-prometheus + first prometheus workspace
          const prodWs = allWs.find((w) => w.workspaceName === 'production') || allWs[0];
          const autoIds = [...nonPromIds, ...(prodWs ? [prodWs.id] : [])];
          if (autoIds.length > 0) {
            setSelectedDsIds(autoIds);
          }
        } else if (nonPromIds.length > 0) {
          // No Prometheus datasources — auto-select all OpenSearch datasources
          setSelectedDsIds(nonPromIds);
        }
      } catch (e: unknown) {
        console.error('Failed to load datasources', e);
      }
    })();
  }, [apiClient]);

  // ---- Fetch data when datasource selection or page changes ----

  const fetchAlerts = useCallback(
    async (dsIds: string[], page: number, pageSize: number) => {
      if (dsIds.length === 0) {
        setAlerts([]);
        setAlertsTotal(0);
        return;
      }
      setDataLoading(true);
      setError(null);
      setWarnings([]);
      try {
        const res = await apiClient.listAlertsPaginated(dsIds, page, pageSize);
        setAlerts(res.results || []);
        setAlertsTotal(res.total || 0);
        if (res.warnings && res.warnings.length > 0) {
          setWarnings(
            res.warnings.map((w: DatasourceWarning) => ({
              datasourceName: w.datasourceName,
              error: w.error,
            }))
          );
        }
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Failed to fetch alerts');
      } finally {
        setDataLoading(false);
      }
    },
    [apiClient]
  );

  const fetchRules = useCallback(
    async (dsIds: string[], page: number, pageSize: number) => {
      if (dsIds.length === 0) {
        setRules([]);
        setRulesTotal(0);
        return;
      }
      setDataLoading(true);
      setError(null);
      setWarnings([]);
      try {
        const res = await apiClient.listRulesPaginated(dsIds, page, pageSize);
        setRules(res.results || []);
        setRulesTotal(res.total || 0);
        if (res.warnings && res.warnings.length > 0) {
          setWarnings(
            res.warnings.map((w: DatasourceWarning) => ({
              datasourceName: w.datasourceName,
              error: w.error,
            }))
          );
        }
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Failed to fetch rules');
      } finally {
        setDataLoading(false);
      }
    },
    [apiClient]
  );

  // Fetch when selection or pagination changes
  useEffect(() => {
    if (selectedDsIds.length === 0) return;
    if (activeTab === 'alerts') {
      fetchAlerts(selectedDsIds, alertsPage, alertsPageSize);
    }
  }, [selectedDsIds, alertsPage, alertsPageSize, activeTab, fetchAlerts]);

  useEffect(() => {
    if (selectedDsIds.length === 0) return;
    if (activeTab === 'rules') {
      fetchRules(selectedDsIds, rulesPage, rulesPageSize);
    }
  }, [selectedDsIds, rulesPage, rulesPageSize, activeTab, fetchRules]);

  // Reset pages when datasource selection changes
  const handleDatasourceChange = useCallback((ids: string[]) => {
    setSelectedDsIds(ids);
    setAlertsPage(1);
    setRulesPage(1);
    setDeletedRuleIds(new Set());
  }, []);

  // ---- Handlers ----

  const handleAcknowledgeAlert = async (alertId: string) => {
    const alert = alerts.find((a) => a.id === alertId);
    try {
      await apiClient.acknowledgeAlert(alertId, alert?.datasourceId, alert?.labels?.monitor_id);
      addToast('Alert acknowledged');
      setAlerts((prev) =>
        prev.map((a) =>
          a.id === alertId
            ? { ...a, state: 'acknowledged' as const, lastUpdated: new Date().toISOString() }
            : a
        )
      );
      // Update the flyout's selected alert inline so it stays open with fresh state
      setSelectedAlert((prev) =>
        prev && prev.id === alertId
          ? { ...prev, state: 'acknowledged' as const, lastUpdated: new Date().toISOString() }
          : prev
      );
    } catch (e: unknown) {
      addToast('Failed to acknowledge alert', 'danger', e instanceof Error ? e.message : String(e));
    }
  };

  const handleSilenceAlert = async (alertId: string) => {
    try {
      await apiClient.silenceAlert(alertId);
      addToast('Alert silenced');
      // Silence creates a suppression rule — the alert remains active but is silenced.
      // We add a 'silenced' label as a visual indicator; the state stays unchanged.
      setAlerts((prev) =>
        prev.map((a) =>
          a.id === alertId
            ? {
                ...a,
                labels: { ...a.labels, _silenced: 'true' },
                lastUpdated: new Date().toISOString(),
              }
            : a
        )
      );
      // Update the flyout's selected alert inline so it stays open with fresh state
      setSelectedAlert((prev) =>
        prev && prev.id === alertId
          ? {
              ...prev,
              labels: { ...prev.labels, _silenced: 'true' },
              lastUpdated: new Date().toISOString(),
            }
          : prev
      );
    } catch (e: unknown) {
      addToast('Failed to silence alert', 'danger', e instanceof Error ? e.message : String(e));
    }
  };

  const handleDeleteRules = async (ids: string[]) => {
    const failed: string[] = [];
    for (const id of ids) {
      try {
        await apiClient.deleteMonitor(id);
      } catch (e: unknown) {
        failed.push(id);
        addToast('Failed to delete monitor', 'danger', e instanceof Error ? e.message : String(e));
      }
    }
    const succeeded = ids.filter((id) => !failed.includes(id));
    if (succeeded.length > 0) {
      addToast(succeeded.length + ' monitor(s) deleted');
    }
    setDeletedRuleIds((prev) => {
      const next = new Set(prev);
      succeeded.forEach((id) => next.add(id));
      return next;
    });
    if (succeeded.length > 0) {
      setRulesTotal((prev) => Math.max(0, prev - succeeded.length));
    }
  };

  const handleSilenceRule = async (id: string) => {
    const rule = rules.find((r) => r.id === id);
    const toggleStatus = () =>
      setRules((prev) =>
        prev.map((r) => {
          if (r.id === id) {
            const newStatus: 'active' | 'muted' = r.status === 'muted' ? 'active' : 'muted';
            return { ...r, status: newStatus };
          }
          return r;
        })
      );
    if (rule && rule.status === 'muted') {
      try {
        await apiClient.deleteSuppressionRule(id);
        addToast('Monitor unmuted');
        toggleStatus();
      } catch (e: unknown) {
        addToast('Failed to unmute monitor', 'danger', e instanceof Error ? e.message : String(e));
      }
    } else {
      try {
        await apiClient.createSuppressionRule({
          name: `Silence ${rule?.name || id}`,
          matchers: { monitor_id: id },
          schedule: {
            type: 'one_time',
            start: new Date().toISOString(),
            end: new Date(Date.now() + 3600000).toISOString(),
          },
          enabled: true,
        });
        addToast('Monitor muted for 1 hour');
        toggleStatus();
      } catch (e: unknown) {
        addToast('Failed to mute monitor', 'danger', e instanceof Error ? e.message : String(e));
      }
    }
  };

  const handleCloneRule = async (monitor: UnifiedRule) => {
    const clone: UnifiedRule = {
      ...monitor,
      id: `clone-${Date.now()}`,
      name: `${monitor.name} (Copy)`,
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      createdBy: 'current-user',
    };
    try {
      await apiClient.createMonitor(clone);
      addToast('Monitor cloned');
      setRules((prev) => [clone, ...prev]);
    } catch (e: unknown) {
      addToast('Failed to clone monitor', 'danger', e instanceof Error ? e.message : String(e));
    }
  };

  const handleImportMonitors = async (configs: Array<Record<string, unknown>>) => {
    try {
      await apiClient.importMonitors(configs);
      addToast('Monitors imported successfully');
      fetchRules(selectedDsIds, rulesPage, rulesPageSize);
    } catch (e: unknown) {
      addToast('Failed to import monitors', 'danger', e instanceof Error ? e.message : String(e));
    }
  };

  const formStateToRule = (formState: MonitorFormState, index = 0): UnifiedRule => {
    const now = new Date().toISOString();

    if (formState.datasourceType === 'prometheus') {
      const labelsObj: Record<string, string> = {};
      for (const l of formState.labels) {
        if (l.key && l.value) labelsObj[l.key] = l.value;
      }
      const annotationsObj: Record<string, string> = {};
      for (const a of formState.annotations) {
        if (a.key && a.value) annotationsObj[a.key] = a.value;
      }
      return {
        id: `new-${Date.now()}-${index}`,
        datasourceId: formState.datasourceId || selectedDsIds[0] || 'ds-2',
        datasourceType: 'prometheus',
        name: formState.name,
        enabled: formState.enabled,
        severity: formState.severity,
        query: formState.query,
        condition: `${formState.threshold.operator} ${formState.threshold.value}${formState.threshold.unit}`,
        labels: labelsObj,
        annotations: annotationsObj,
        monitorType: 'metric',
        status: formState.enabled ? 'active' : 'disabled',
        healthStatus: 'healthy',
        createdBy: 'current-user',
        createdAt: now,
        lastModified: now,
        notificationDestinations: [],
        description: annotationsObj.description || '',
        aiSummary: 'Newly created monitor. No historical data available yet.',
        evaluationInterval: formState.evaluationInterval,
        pendingPeriod: formState.pendingPeriod,
        firingPeriod: formState.firingPeriod,
        threshold: {
          operator: formState.threshold.operator,
          value: formState.threshold.value,
          unit: formState.threshold.unit,
        },
        alertHistory: [],
        conditionPreviewData: [],
        notificationRouting: [],
        suppressionRules: [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw field is empty for new monitors
        raw: {} as any,
      };
    } else {
      // OpenSearch monitor
      const isPPL = formState.monitorType === 'ppl_monitor';
      const indices = formState.indices
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const monitorType =
        formState.monitorType === 'ppl_monitor'
          ? ('metric' as const)
          : formState.monitorType === 'bucket_level_monitor'
            ? ('infrastructure' as const)
            : formState.monitorType === 'doc_level_monitor'
              ? ('log' as const)
              : ('metric' as const);

      // PPL monitors have Prometheus-like labels/annotations
      const labelsObj: Record<string, string> = {};
      const annotationsObj: Record<string, string> = {};
      if (isPPL) {
        for (const l of formState.labels) {
          if (l.key && l.value) labelsObj[l.key] = l.value;
        }
        for (const a of formState.annotations) {
          if (a.key && a.value) annotationsObj[a.key] = a.value;
        }
      }
      if (indices.length > 0) labelsObj.indices = indices.join(', ');
      labelsObj.monitorType = formState.monitorType;

      return {
        id: `new-${Date.now()}-${index}`,
        datasourceId: formState.datasourceId || selectedDsIds[0] || 'ds-1',
        datasourceType: 'opensearch',
        name: formState.name,
        enabled: formState.enabled,
        severity: formState.severity,
        query: formState.query,
        condition: isPPL
          ? `${formState.threshold.operator} ${formState.threshold.value}${formState.threshold.unit}`
          : formState.triggerCondition,
        labels: labelsObj,
        annotations: annotationsObj,
        monitorType,
        status: formState.enabled ? 'active' : 'disabled',
        healthStatus: 'healthy',
        createdBy: 'current-user',
        createdAt: now,
        lastModified: now,
        notificationDestinations: formState.actionName ? [formState.actionName] : [],
        description: isPPL
          ? `OpenSearch PPL monitor${indices.length > 0 ? ` on ${indices.join(', ')}` : ''}`
          : `OpenSearch ${formState.monitorType} on ${indices.join(', ')}`,
        aiSummary: 'Newly created OpenSearch monitor. No historical data available yet.',
        evaluationInterval: isPPL
          ? formState.evaluationInterval
          : `${formState.schedule.interval} ${formState.schedule.unit.toLowerCase()}`,
        pendingPeriod: isPPL ? formState.pendingPeriod : '5 minutes',
        threshold: isPPL
          ? {
              operator: formState.threshold.operator,
              value: formState.threshold.value,
              unit: formState.threshold.unit,
            }
          : undefined,
        alertHistory: [],
        conditionPreviewData: [],
        notificationRouting: [],
        suppressionRules: [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw field is empty for new monitors
        raw: {} as any,
      };
    }
  };

  const handleCreateMonitor = async (formState: MonitorFormState) => {
    const newRule = formStateToRule(formState);
    try {
      await apiClient.createMonitor(formState);
      addToast('Monitor created successfully');
      setRules((prev) => [newRule, ...prev]);
      setRulesTotal((prev) => prev + 1);
      setShowCreateMonitor(false);
    } catch (e: unknown) {
      addToast('Failed to create monitor', 'danger', e instanceof Error ? e.message : String(e));
    }
  };

  const handleBatchCreateMonitors = async (forms: MonitorFormState[]) => {
    const succeededRules: UnifiedRule[] = [];
    for (let i = 0; i < forms.length; i++) {
      try {
        await apiClient.createMonitor(forms[i]);
        succeededRules.push(formStateToRule(forms[i], i));
      } catch (e: unknown) {
        addToast('Failed to create monitor', 'danger', e instanceof Error ? e.message : String(e));
      }
    }
    if (succeededRules.length > 0) {
      addToast(succeededRules.length + ' monitor(s) created successfully');
      setRules((prev) => [...succeededRules, ...prev]);
      setRulesTotal((prev) => prev + succeededRules.length);
    }
    // Don't close flyout — AI wizard shows its own summary step and "Done" button
  };

  // ---- Form-to-API transformation helpers ----

  const mapUnit = (unit: string): string => {
    const lower = unit.toLowerCase().replace(/\(s\)$/, '');
    if (lower === 'minute') return 'MINUTES';
    if (lower === 'hour') return 'HOURS';
    if (lower === 'day') return 'DAYS';
    return 'MINUTES';
  };

  const mapSeverity = (severity: string): '1' | '2' | '3' | '4' | '5' => {
    const map: Record<string, '1' | '2' | '3' | '4' | '5'> = {
      critical: '1',
      high: '2',
      medium: '3',
      low: '4',
      info: '5',
    };
    return map[severity] || '3';
  };

  const buildConditionScript = (trigger: {
    conditionOperator: string;
    conditionValue: number;
  }): string => {
    const opMap: Record<string, string> = {
      is_greater_than: '>',
      is_less_than: '<',
      is_equal_to: '==',
      is_greater_equal: '>=',
      is_less_equal: '<=',
      is_not_equal: '!=',
    };
    const op = opMap[trigger.conditionOperator] || '>';
    return `ctx.results[0].hits.total.value ${op} ${trigger.conditionValue}`;
  };

  const parseQuery = (query: string): Record<string, unknown> => {
    try {
      return JSON.parse(query);
    } catch {
      return { query_string: { query } };
    }
  };

  const transformLogsFormToPayload = (form: LogsMonitorFormState): Record<string, unknown> => ({
    type: 'monitor',
    name: form.monitorName,
    enabled: true,
    schedule: {
      period: { interval: form.runEveryValue, unit: mapUnit(form.runEveryUnit) },
    },
    inputs: [
      {
        search: {
          indices: [form.selectedDatasource],
          query: { size: 0, query: parseQuery(form.query) },
        },
      },
    ],
    triggers: form.triggers.map((t) => ({
      name: t.name,
      severity: mapSeverity(t.severityLevel),
      condition: {
        script: { source: buildConditionScript(t), lang: 'painless' },
      },
      actions: t.actions.map((a) => ({
        name: a.name,
        destination_id: a.notificationChannel,
        message_template: { source: a.message || '' },
        subject_template: { source: a.subject || '' },
        throttle_enabled: t.suppressEnabled,
        throttle: t.suppressEnabled
          ? { value: t.suppressExpiry, unit: mapUnit(t.suppressExpiryUnit) }
          : undefined,
      })),
    })),
  });

  const transformMetricsFormToPayload = (
    form: MetricsMonitorFormState
  ): Record<string, unknown> => ({
    name: form.monitorName,
    rules: [
      {
        alert: form.monitorName,
        expr: `${form.query} ${form.operator} ${form.thresholdValue}`,
        for: form.forDuration,
        labels: Object.fromEntries(
          form.labels.filter((l) => l.key && l.value).map((l) => [l.key, l.value])
        ),
        annotations: Object.fromEntries(
          form.annotations.filter((a) => a.key && a.value).map((a) => [a.key, a.value])
        ),
      },
    ],
  });

  const handleCreateLogsMonitor = async (logsForm: LogsMonitorFormState) => {
    const now = new Date().toISOString();
    const allActions = logsForm.triggers.flatMap((t) => t.actions);
    const rawSev = logsForm.triggers[0]?.severityLevel || 'medium';
    const logsSeverity = (
      ['critical', 'high', 'medium', 'low', 'info'].includes(rawSev) ? rawSev : 'medium'
    ) as 'critical' | 'high' | 'medium' | 'low' | 'info';
    const newRule: UnifiedRule = {
      id: `new-logs-${Date.now()}`,
      datasourceId: selectedDsIds[0] || 'ds-1',
      datasourceType: 'opensearch',
      name: logsForm.monitorName,
      enabled: true,
      severity: logsSeverity,
      query:
        logsForm.monitorType === 'cluster_metrics' ? logsForm.clusterMetricsApi : logsForm.query,
      condition: logsForm.triggers
        .map((t) => `${t.conditionOperator} ${t.conditionValue}`)
        .join(', '),
      labels: { monitorType: logsForm.monitorType },
      annotations: { description: logsForm.description },
      monitorType: 'log',
      status: 'active',
      healthStatus: 'healthy',
      createdBy: 'current-user',
      createdAt: now,
      lastModified: now,
      notificationDestinations: allActions.map((a) => a.name),
      description: logsForm.description,
      aiSummary: 'Newly created logs monitor.',
      evaluationInterval: `${logsForm.runEveryValue} ${logsForm.runEveryUnit}`,
      pendingPeriod: '5 minutes',
      threshold: logsForm.triggers[0]
        ? {
            operator: logsForm.triggers[0].conditionOperator,
            value: logsForm.triggers[0].conditionValue,
            unit: '',
          }
        : undefined,
      alertHistory: [],
      conditionPreviewData: [],
      notificationRouting: [],
      suppressionRules: [],
      raw: {} as any,
    };
    try {
      await apiClient.createMonitor(transformLogsFormToPayload(logsForm), selectedDsIds[0]);
      addToast('Logs monitor created successfully');
      setRules((prev) => [newRule, ...prev]);
      setRulesTotal((prev) => prev + 1);
      setCreateMonitorType(null);
    } catch (e: unknown) {
      addToast(
        'Failed to create logs monitor',
        'danger',
        e instanceof Error ? e.message : String(e)
      );
    }
  };

  const handleCreateMetricsMonitor = async (metricsForm: MetricsMonitorFormState) => {
    const now = new Date().toISOString();
    const severityLabel = metricsForm.labels.find((l) => l.key === 'severity');
    const rawSeverity = severityLabel?.value || 'medium';
    const condition = `${metricsForm.operator} ${metricsForm.thresholdValue}`;
    const labelsObj: Record<string, string> = {};
    for (const l of metricsForm.labels) {
      if (l.key && l.value) labelsObj[l.key] = l.value;
    }
    const annotationsObj: Record<string, string> = {};
    for (const a of metricsForm.annotations) {
      if (a.key && a.value) annotationsObj[a.key] = a.value;
    }
    const newRule: UnifiedRule = {
      id: `new-metrics-${Date.now()}`,
      datasourceId: metricsForm.datasourceId || selectedDsIds[0] || 'ds-2',
      datasourceType: 'prometheus',
      name: metricsForm.monitorName,
      enabled: true,
      severity: (['critical', 'high', 'medium', 'low', 'info'].includes(rawSeverity)
        ? rawSeverity
        : 'medium') as 'critical' | 'high' | 'medium' | 'low' | 'info',
      query: metricsForm.query,
      condition,
      labels: labelsObj,
      annotations: annotationsObj,
      monitorType: 'metric',
      status: 'active',
      healthStatus: 'healthy',
      createdBy: 'current-user',
      createdAt: now,
      lastModified: now,
      notificationDestinations: metricsForm.actions.map((a) => a.name),
      description: metricsForm.description,
      aiSummary: 'Newly created metrics monitor.',
      evaluationInterval: metricsForm.evalInterval,
      pendingPeriod: metricsForm.pendingPeriod,
      firingPeriod: metricsForm.firingPeriod,
      threshold: { operator: metricsForm.operator, value: metricsForm.thresholdValue, unit: '' },
      alertHistory: [],
      conditionPreviewData: [],
      notificationRouting: [],
      suppressionRules: [],
      raw: {} as any,
    };
    try {
      await apiClient.createMonitor(
        transformMetricsFormToPayload(metricsForm),
        metricsForm.datasourceId
      );
      addToast('Metrics monitor created successfully');
      setRules((prev) => [newRule, ...prev]);
      setRulesTotal((prev) => prev + 1);
      setCreateMonitorType(null);
    } catch (e: unknown) {
      addToast(
        'Failed to create metrics monitor',
        'danger',
        e instanceof Error ? e.message : String(e)
      );
    }
  };

  // ---- Render ----

  const tabs = [
    { id: 'alerts' as TabId, name: `Alerts (${alertsTotal})` },
    { id: 'rules' as TabId, name: rulesTotal >= 0 ? `Rules (${rulesTotal})` : 'Rules' },
    { id: 'routing' as TabId, name: 'Routing' },
    { id: 'suppression' as TabId, name: 'Suppression' },
    { id: 'slos' as TabId, name: 'SLOs' },
    { id: 'services' as TabId, name: 'Services' },
  ];

  const renderTable = () => {
    if (activeTab === 'alerts') {
      return (
        <>
          <AlertsDashboard
            alerts={alerts}
            datasources={datasources}
            loading={dataLoading}
            onViewDetail={(alert) => setSelectedAlert(alert)}
            onAcknowledge={handleAcknowledgeAlert}
            onSilence={handleSilenceAlert}
            workspaceOptions={workspaceOptions}
            loadingWorkspaces={loadingWorkspaces}
            selectedDsIds={selectedDsIds}
            onDatasourceChange={handleDatasourceChange}
          />
        </>
      );
    }
    if (activeTab === 'rules') {
      return (
        <MonitorsTable
          rules={visibleRules}
          datasources={datasources}
          loading={dataLoading}
          apiClient={apiClient}
          onDelete={handleDeleteRules}
          onSilence={handleSilenceRule}
          onClone={handleCloneRule}
          onImport={handleImportMonitors}
          onCreateMonitor={(type) => {
            if (type === 'logs') {
              setShowCreateMonitor(false);
              setCreateMonitorType('logs');
            } else if (type === 'metrics') {
              setShowCreateMonitor(false);
              setCreateMonitorType('metrics');
            }
          }}
          workspaceOptions={workspaceOptions}
          loadingWorkspaces={loadingWorkspaces}
          selectedDsIds={selectedDsIds}
          onDatasourceChange={handleDatasourceChange}
        />
      );
    }
    if (activeTab === 'routing') {
      return <NotificationRoutingPanel apiClient={apiClient} />;
    }
    if (activeTab === 'suppression') {
      return <SuppressionRulesPanel apiClient={apiClient} />;
    }
    if (activeTab === 'slos') {
      return (
        <SloListing
          apiClient={apiClient}
          navigationService={navigationService}
          initialSloId={routeState.sloId ?? undefined}
          onSloSelect={routeActions.openSlo}
          onSloClose={routeActions.closeSlo}
        />
      );
    }
    if (activeTab === 'services') {
      return (
        <ServicesTab
          apiClient={apiClient}
          navigationService={navigationService}
          initialServiceName={routeState.serviceName ?? undefined}
          onServiceSelect={routeActions.openService}
          onServiceClose={routeActions.closeService}
        />
      );
    }
    return null;
  };

  return (
    <EuiPage data-test-subj="alertManager-page">
      <EuiPageBody component="main">
        <EuiPageHeader>
          <EuiPageHeaderSection>
            <EuiTitle size="l">
              <h1>Alert Manager</h1>
            </EuiTitle>
          </EuiPageHeaderSection>
        </EuiPageHeader>
        <EuiSpacer size="m" />
        <EuiTabs data-test-subj="alertManager-tabs">
          {tabs.map((t) => (
            <EuiTab
              key={t.id}
              isSelected={activeTab === t.id}
              onClick={() => setActiveTab(t.id)}
              data-test-subj={`alertManager-tabs-${t.id}`}
            >
              {t.name}
            </EuiTab>
          ))}
        </EuiTabs>
        <EuiSpacer size="s" />

        {/* Datasource selector removed — now integrated into filter panels */}

        {error && (
          <EuiCallOut
            title="Error loading data"
            color="danger"
            iconType="alert"
            size="s"
            style={{ marginBottom: 12 }}
          >
            <p>{error}</p>
          </EuiCallOut>
        )}

        {warnings.length > 0 && (
          <EuiCallOut
            title="Some datasources could not be reached"
            color="warning"
            iconType="alert"
            size="s"
            style={{ marginBottom: 12 }}
          >
            {warnings.map((w, i) => (
              <p key={i}>
                <strong>{w.datasourceName}</strong>: {w.error}
              </p>
            ))}
          </EuiCallOut>
        )}

        <div aria-live="polite" className="euiScreenReaderOnly">
          {`Showing ${tabs.find((t) => t.id === activeTab)?.name ?? activeTab} tab`}
        </div>
        {renderTable()}
        {showCreateMonitor && (
          <CreateMonitor
            onSave={handleCreateMonitor}
            onBatchSave={handleBatchCreateMonitors}
            onCancel={() => setShowCreateMonitor(false)}
            datasources={creatableDatasources}
            selectedDsIds={selectedDsIds}
          />
        )}
        {createMonitorType === 'logs' && (
          <CreateLogsMonitor
            onCancel={() => setCreateMonitorType(null)}
            onSave={handleCreateLogsMonitor}
          />
        )}
        {createMonitorType === 'metrics' && (
          <CreateMetricsMonitor
            onCancel={() => setCreateMonitorType(null)}
            onSave={handleCreateMetricsMonitor}
          />
        )}
        {selectedAlert && (
          <AlertDetailFlyout
            alert={selectedAlert}
            datasources={datasources}
            apiClient={apiClient}
            navigationService={navigationService}
            onClose={() => setSelectedAlert(null)}
            onAcknowledge={(id) => {
              handleAcknowledgeAlert(id);
            }}
            onSilence={(id) => {
              handleSilenceAlert(id);
            }}
          />
        )}
        <EuiGlobalToastList
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- EuiGlobalToastList toast type mismatch
          toasts={toasts as any}
          dismissToast={(t: { id: string }) =>
            setToasts((prev) => prev.filter((p) => p.id !== t.id))
          }
          toastLifeTimeMs={4000}
        />
      </EuiPageBody>
    </EuiPage>
  );
};
