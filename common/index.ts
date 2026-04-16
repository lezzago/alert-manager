/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Common module exports
 */
export { PLUGIN_ID, PLUGIN_NAME, API_BASE } from './constants';

export * from './types';
export { InMemoryDatasourceService } from './datasource_service';
export { MultiBackendAlertService } from './alert_service';
export { HttpOpenSearchBackend } from './opensearch_backend';
export { DirectQueryPrometheusBackend } from './directquery_prometheus_backend';
export type { DirectQueryConfig } from './directquery_prometheus_backend';
export { HttpClient, buildAuthFromDatasource } from './http_client';
export { parseDuration, formatDuration, validateMonitorForm } from './validators';
export type {
  MonitorFormState,
  ValidationResult,
  ThresholdCondition,
  LabelEntry,
  AnnotationEntry,
} from './validators';
export { validatePromQL, prettifyPromQL } from './promql_validator';
export type { PromQLError, PromQLValidationResult } from './promql_validator';
export { serializeMonitor, serializeMonitors, deserializeMonitor } from './serializer';
export type { MonitorConfig } from './serializer';
export { SuppressionRuleService } from './suppression';
export type { SuppressionRuleConfig } from './suppression';
export { matchesSearch, matchesFilters, sortRules, filterAlerts, emptyFilters } from './filter';
export type { FilterState } from './filter';
export * from './slo_types';
export { SloService } from './slo_service';
export { InMemorySloStore } from './slo_store';
export {
  generateSloRuleGroup,
  sanitizeName,
  shortHash,
  parseDurationToMs,
  RECORDING_WINDOWS,
} from './slo_promql_generator';
export { validateSloForm, validateSloFormFull, isSloFormValid } from './slo_validators';
export type { SloValidationResult } from './slo_validators';

export { OtelServiceDiscoveryService } from './otel_service_discovery';
export { ApmConfigReader } from './apm_config_reader';
export { OpenSearchOtelProvider } from './opensearch_otel_provider';
export { AlertCorrelationService } from './alert_correlation_service';
export { OpenSearchCorrelationProvider } from './opensearch_correlation_provider';
export { RootCauseAnalysisService } from './root_cause_analysis_service';
export { computeCoverageGaps, computeGapSeverity } from './coverage_gap_service';
export {
  forecastErrorBudgetExhaustion,
  formatTimeRemaining,
  forecastSeverityFromTime,
} from './error_budget_forecast';
export { groupIncidents, findRootService } from './incident_grouping_service';
export * from './root_cause_types';

export type { AlertManagerError, NotFoundError, ValidationError, InternalError } from './errors';
export {
  createNotFoundError,
  createValidationError,
  createInternalError,
  isAlertManagerError,
  errorToStatus,
} from './errors';
