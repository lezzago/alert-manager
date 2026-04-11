/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Navigation service for cross-app deep linking.
 *
 * In OSD mode, uses `core.application.navigateToApp()` for SPA navigation.
 * In standalone mode, opens URLs in a new tab (since other OSD apps aren't available).
 */
import {
  APP_IDS,
  buildApmServiceUrl,
  buildTraceExplorerUrl,
  buildLogExplorerUrl,
  buildAlertTimeRange,
} from '../../common/deep_links';

/**
 * Minimal interface matching OSD's core.application.
 * Prevents tight coupling to the full CoreStart type.
 */
export interface AppNavigator {
  navigateToApp: (appId: string, options?: { path?: string }) => Promise<void>;
}

export class NavigationService {
  constructor(
    private readonly appNavigator?: AppNavigator,
    private readonly mode: 'osd' | 'standalone' = 'osd'
  ) {}

  /** Navigate to the APM service detail view. */
  navigateToApmService(serviceName: string, timeRange?: { from: string; to: string }): void {
    const path = buildApmServiceUrl(serviceName, timeRange);
    this.navigate(APP_IDS.APM, path);
  }

  /** Navigate to the Trace Explorer for a specific trace. */
  navigateToTrace(traceId: string): void {
    const path = buildTraceExplorerUrl(traceId);
    this.navigate(APP_IDS.OBSERVABILITY, path);
  }

  /** Navigate to the Log Explorer with a service filter. */
  navigateToLogs(
    serviceName: string,
    timeRange?: { from: string; to: string },
    query?: string
  ): void {
    const path = buildLogExplorerUrl(serviceName, timeRange, query);
    this.navigate(APP_IDS.LOGS, path);
  }

  /**
   * Navigate to APM service detail with time range derived from an alert.
   */
  navigateToApmServiceFromAlert(
    serviceName: string,
    alertStartTime: string,
    alertEndTime?: string
  ): void {
    const timeRange = buildAlertTimeRange(alertStartTime, alertEndTime);
    this.navigateToApmService(serviceName, timeRange);
  }

  /** Whether cross-app navigation is available (OSD mode with navigator). */
  get isAvailable(): boolean {
    return this.mode === 'osd' && this.appNavigator !== undefined;
  }

  private navigate(appId: string, path: string): void {
    if (this.appNavigator && this.mode === 'osd') {
      this.appNavigator.navigateToApp(appId, { path });
    } else {
      // Standalone fallback: construct a best-effort URL.
      // In standalone mode, OSD apps aren't available — open in new tab.
      const url = `/app/${appId}${path}`;
      window.open(url, '_blank');
    }
  }
}
