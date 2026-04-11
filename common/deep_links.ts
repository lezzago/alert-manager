/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Deep link URL builders for bidirectional navigation between
 * Alert Manager and other OSD apps (APM, Logs, Traces).
 *
 * Two categories:
 *  1. Internal hash routes — deep-linkable state within Alert Manager
 *  2. External app links — URLs to APM, Trace Explorer, Log Explorer
 */

import { PLUGIN_ID } from './constants';

// ============================================================================
// Internal Hash Routes (Alert Manager)
// ============================================================================

export type AlertManagerTab = 'alerts' | 'rules' | 'routing' | 'suppression' | 'slos' | 'services';

/**
 * Parsed representation of an Alert Manager hash route.
 * The hash encodes the active tab and optional detail view.
 */
export interface HashRoute {
  tab: AlertManagerTab;
  /** Alert detail: { dsId, alertId } */
  alertDetail?: { datasourceId: string; alertId: string };
  /** SLO detail ID */
  sloId?: string;
  /** Service detail name */
  serviceName?: string;
}

const VALID_TABS = new Set<AlertManagerTab>([
  'alerts',
  'rules',
  'routing',
  'suppression',
  'slos',
  'services',
]);

/**
 * Build a hash string for a given route.
 *
 * Examples:
 *  - buildHash({ tab: 'alerts' })                           → '#/alerts'
 *  - buildHash({ tab: 'alerts', alertDetail: { ... } })     → '#/alerts/ds-1/alert-123'
 *  - buildHash({ tab: 'services', serviceName: 'api-gw' })  → '#/services/api-gw'
 *  - buildHash({ tab: 'slos', sloId: 'slo-1' })             → '#/slos/slo-1'
 */
export function buildHash(route: HashRoute): string {
  const base = `#/${route.tab}`;
  if (route.tab === 'alerts' && route.alertDetail) {
    return `${base}/${encodeURIComponent(route.alertDetail.datasourceId)}/${encodeURIComponent(route.alertDetail.alertId)}`;
  }
  if (route.tab === 'slos' && route.sloId) {
    return `${base}/${encodeURIComponent(route.sloId)}`;
  }
  if (route.tab === 'services' && route.serviceName) {
    return `${base}/${encodeURIComponent(route.serviceName)}`;
  }
  return base;
}

/**
 * Parse a hash string into a HashRoute. Returns default (alerts tab) for
 * invalid/empty hashes.
 *
 * Supported formats:
 *  - #/alerts                          → { tab: 'alerts' }
 *  - #/alerts/{dsId}/{alertId}         → { tab: 'alerts', alertDetail: { datasourceId, alertId } }
 *  - #/slos/{sloId}                    → { tab: 'slos', sloId }
 *  - #/services/{serviceName}          → { tab: 'services', serviceName }
 *  - #/rules, #/routing, #/suppression → { tab: ... }
 */
export function parseHash(hash: string): HashRoute {
  const clean = hash.replace(/^#\/?/, '');
  if (!clean) return { tab: 'alerts' };

  const segments = clean.split('/').map(decodeURIComponent);
  const tab = segments[0] as AlertManagerTab;

  if (!VALID_TABS.has(tab)) return { tab: 'alerts' };

  if (tab === 'alerts' && segments.length >= 3) {
    return {
      tab,
      alertDetail: { datasourceId: segments[1], alertId: segments[2] },
    };
  }
  if (tab === 'slos' && segments.length >= 2 && segments[1]) {
    return { tab, sloId: segments[1] };
  }
  if (tab === 'services' && segments.length >= 2 && segments[1]) {
    return { tab, serviceName: segments[1] };
  }
  return { tab };
}

// ============================================================================
// External App Deep Links (APM, Traces, Logs)
// ============================================================================

/** OSD app IDs for navigation targets. */
export const APP_IDS = {
  OBSERVABILITY: 'observability-traces',
  LOGS: 'observability-logs',
  APM: 'observability-traces', // APM uses traces app in OSD
  ALERT_MANAGER: PLUGIN_ID,
} as const;

/**
 * Build a URL path to the APM service detail view for a given service.
 * In OSD, use with `navigateToApp(APP_IDS.APM, { path })`.
 *
 * @param serviceName - OTEL service name
 * @param timeRange - Optional time range { from, to } in ISO or relative format
 */
export function buildApmServiceUrl(
  serviceName: string,
  timeRange?: { from: string; to: string }
): string {
  let path = `#/services/${encodeURIComponent(serviceName)}`;
  if (timeRange) {
    const params = new URLSearchParams();
    params.set('from', timeRange.from);
    params.set('to', timeRange.to);
    path += `?${params.toString()}`;
  }
  return path;
}

/**
 * Build a URL path to the Trace Explorer for a specific trace.
 * In OSD, use with `navigateToApp(APP_IDS.OBSERVABILITY, { path })`.
 */
export function buildTraceExplorerUrl(traceId: string): string {
  return `#/traces/${encodeURIComponent(traceId)}`;
}

/**
 * Build a URL path to the Log Explorer with a query for a specific service.
 *
 * @param serviceName - Filter logs by service
 * @param timeRange - Optional time range
 * @param query - Optional additional query string
 */
export function buildLogExplorerUrl(
  serviceName: string,
  timeRange?: { from: string; to: string },
  query?: string
): string {
  const params = new URLSearchParams();
  const q = query || `serviceName:"${serviceName}"`;
  params.set('query', q);
  if (timeRange) {
    params.set('from', timeRange.from);
    params.set('to', timeRange.to);
  }
  return `#/explorer?${params.toString()}`;
}

/**
 * Build a full Alert Manager URL for external apps to deep-link into.
 * This produces a URL that can be used with `navigateToApp(PLUGIN_ID, { path })`.
 */
export function buildAlertManagerUrl(route: HashRoute): string {
  // Strip the '#' — navigateToApp path doesn't include it
  return buildHash(route).substring(1);
}

/**
 * Build time range params from an alert's start time.
 * Expands by +/- 15 minutes around the alert's active period.
 */
export function buildAlertTimeRange(
  startTime: string,
  endTime?: string
): { from: string; to: string } {
  const start = new Date(startTime);
  const end = endTime ? new Date(endTime) : new Date();
  const BUFFER_MS = 15 * 60 * 1000; // 15 minutes
  return {
    from: new Date(start.getTime() - BUFFER_MS).toISOString(),
    to: new Date(end.getTime() + BUFFER_MS).toISOString(),
  };
}
