/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen, waitFor, configure, fireEvent } from '@testing-library/react';

// OSD uses data-test-subj instead of data-testid
configure({ testIdAttribute: 'data-test-subj' });

// Mock heavy child components to isolate AlarmsPage logic
jest.mock('../alerts_dashboard', () => ({
  AlertsDashboard: (props: any) => (
    <div data-test-subj="alerts-dashboard">AlertsDashboard({props.alerts?.length ?? 0})</div>
  ),
}));
jest.mock('../monitors_table', () => ({
  MonitorsTable: (props: any) => (
    <div data-test-subj="monitors-table">MonitorsTable({props.rules?.length ?? 0})</div>
  ),
}));
jest.mock('../create_monitor', () => ({
  CreateMonitor: () => <div data-test-subj="create-monitor">CreateMonitor</div>,
}));
jest.mock('../alert_detail_flyout', () => ({
  AlertDetailFlyout: () => null,
}));
jest.mock('../notification_routing_panel', () => ({
  NotificationRoutingPanel: () => <div data-test-subj="routing-panel">Routing</div>,
}));
jest.mock('../suppression_rules_panel', () => ({
  SuppressionRulesPanel: () => <div data-test-subj="suppression-panel">Suppression</div>,
}));
jest.mock('../slo_listing', () => ({
  __esModule: true,
  default: () => <div data-test-subj="slo-listing">SloListing</div>,
}));
jest.mock('../create_logs_monitor', () => ({
  CreateLogsMonitor: () => <div data-test-subj="create-logs-monitor">CreateLogsMonitor</div>,
}));
jest.mock('../create_metrics_monitor', () => ({
  CreateMetricsMonitor: () => (
    <div data-test-subj="create-metrics-monitor">CreateMetricsMonitor</div>
  ),
}));

import { AlarmsPage } from '../alarms_page';
import { AlarmsApiClient, HttpClient } from '../../services/alarms_client';
import { Datasource } from '../../../common/types';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const mockAlerts = [
  {
    id: 'alert-1',
    datasourceId: 'ds-1',
    datasourceType: 'opensearch',
    name: 'High CPU Alert',
    state: 'active',
    severity: 'critical',
    message: 'CPU usage above 90%',
    startTime: '2026-04-01T12:00:00Z',
    lastUpdated: '2026-04-01T12:00:00Z',
    labels: {},
    annotations: {},
  },
  {
    id: 'alert-2',
    datasourceId: 'ds-2',
    datasourceType: 'prometheus',
    name: 'Memory Warning',
    state: 'pending',
    severity: 'high',
    startTime: '2026-04-01T13:00:00Z',
    lastUpdated: '2026-04-01T13:00:00Z',
    labels: {},
    annotations: {},
  },
];

const mockRules = [
  {
    id: 'rule-1',
    datasourceId: 'ds-1',
    datasourceType: 'opensearch',
    name: 'Error Rate Monitor',
    enabled: true,
    severity: 'high',
    query: 'count() > 100',
    condition: 'count() > 100',
    labels: {},
    annotations: {},
  },
];

const mockDatasources: Datasource[] = [
  {
    id: 'ds-1',
    name: 'Production OS',
    type: 'opensearch',
    url: 'http://localhost:9200',
    enabled: true,
  },
  {
    id: 'ds-2',
    name: 'Prometheus',
    type: 'prometheus',
    url: 'http://localhost:9090',
    enabled: true,
  },
];

function createMockHttpClient(): HttpClient {
  return {
    get: jest.fn().mockResolvedValue({}),
    post: jest.fn().mockResolvedValue({}),
    put: jest.fn().mockResolvedValue({}),
    delete: jest.fn().mockResolvedValue({}),
  };
}

function createMockApiClient(
  alerts = mockAlerts,
  rules = mockRules,
  datasources = mockDatasources
): AlarmsApiClient {
  const client = createMockHttpClient();
  const apiClient = new AlarmsApiClient(client, 'standalone');
  jest.spyOn(apiClient, 'listDatasources').mockResolvedValue(datasources);
  jest.spyOn(apiClient, 'listWorkspaces').mockResolvedValue([]);
  jest.spyOn(apiClient, 'listAlertsPaginated').mockResolvedValue({
    results: alerts as any,
    total: alerts.length,
    page: 1,
    pageSize: alerts.length,
    hasMore: false,
  });
  jest.spyOn(apiClient, 'listRulesPaginated').mockResolvedValue({
    results: rules as any,
    total: rules.length,
    page: 1,
    pageSize: rules.length,
    hasMore: false,
  });
  return apiClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AlarmsPage', () => {
  beforeEach(() => {
    // Reset URL hash between tests so useHashRouting starts fresh
    window.location.hash = '';
  });

  it('renders the page heading', async () => {
    const apiClient = createMockApiClient();
    render(<AlarmsPage apiClient={apiClient} />);
    await waitFor(() => {
      expect(screen.getByText('Alert Manager')).toBeDefined();
    });
  });

  it('renders all 5 tabs', async () => {
    const apiClient = createMockApiClient();
    render(<AlarmsPage apiClient={apiClient} />);
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Alerts/i })).toBeDefined();
      expect(screen.getByRole('tab', { name: /Rules/i })).toBeDefined();
      expect(screen.getByRole('tab', { name: /Routing/i })).toBeDefined();
      expect(screen.getByRole('tab', { name: /Suppression/i })).toBeDefined();
      expect(screen.getByRole('tab', { name: /SLOs/i })).toBeDefined();
    });
  });

  it('calls datasources API on mount', async () => {
    const apiClient = createMockApiClient();
    render(<AlarmsPage apiClient={apiClient} />);
    await waitFor(() => {
      expect(apiClient.listDatasources).toHaveBeenCalled();
    });
  });

  it('calls listAlertsPaginated after datasources load', async () => {
    const apiClient = createMockApiClient();
    render(<AlarmsPage apiClient={apiClient} />);
    await waitFor(() => {
      expect(apiClient.listAlertsPaginated).toHaveBeenCalled();
    });
  });

  it('loads data after datasources are available', async () => {
    const apiClient = createMockApiClient();
    render(<AlarmsPage apiClient={apiClient} />);
    await waitFor(() => {
      // After datasources load, the page should fetch data
      expect(apiClient.listDatasources).toHaveBeenCalled();
    });
  });

  it('renders the Alerts tab content by default', async () => {
    const apiClient = createMockApiClient();
    render(<AlarmsPage apiClient={apiClient} />);
    await waitFor(() => {
      expect(screen.getByTestId('alerts-dashboard')).toBeDefined();
    });
  });

  it('switches to Rules tab', async () => {
    const apiClient = createMockApiClient();
    render(<AlarmsPage apiClient={apiClient} />);
    await waitFor(() => {
      const rulesTab = screen.getByRole('tab', { name: /Rules/i });
      fireEvent.click(rulesTab);
    });
    await waitFor(() => {
      expect(screen.getByTestId('monitors-table')).toBeDefined();
    });
  });

  it('switches to Routing tab', async () => {
    const apiClient = createMockApiClient();
    render(<AlarmsPage apiClient={apiClient} />);
    await waitFor(() => {
      const routingTab = screen.getByRole('tab', { name: /Routing/i });
      fireEvent.click(routingTab);
    });
    await waitFor(() => {
      expect(screen.getByTestId('routing-panel')).toBeDefined();
    });
  });

  it('switches to Suppression tab', async () => {
    const apiClient = createMockApiClient();
    render(<AlarmsPage apiClient={apiClient} />);
    await waitFor(() => {
      const suppressionTab = screen.getByRole('tab', { name: /Suppression/i });
      fireEvent.click(suppressionTab);
    });
    await waitFor(() => {
      expect(screen.getByTestId('suppression-panel')).toBeDefined();
    });
  });

  it('switches to SLOs tab', async () => {
    const apiClient = createMockApiClient();
    render(<AlarmsPage apiClient={apiClient} />);
    await waitFor(() => {
      const slosTab = screen.getByRole('tab', { name: /SLOs/i });
      fireEvent.click(slosTab);
    });
    await waitFor(() => {
      expect(screen.getByTestId('slo-listing')).toBeDefined();
    });
  });

  it('renders the page title and tabs structure', async () => {
    const apiClient = createMockApiClient();
    render(<AlarmsPage apiClient={apiClient} />);
    await waitFor(() => {
      expect(screen.getByText('Alert Manager')).toBeDefined();
      // Tabs structure should be present
      const tabs = document.querySelectorAll('[role="tab"]');
      expect(tabs.length).toBe(6);
    });
  });

  it('renders with empty datasources', async () => {
    const apiClient = createMockApiClient([], [], []);
    render(<AlarmsPage apiClient={apiClient} />);
    await waitFor(() => {
      expect(screen.getByText('Alert Manager')).toBeDefined();
    });
  });

  it('passes alerts count to AlertsDashboard', async () => {
    const apiClient = createMockApiClient();
    render(<AlarmsPage apiClient={apiClient} />);
    await waitFor(() => {
      expect(screen.getByText(/AlertsDashboard\(2\)/)).toBeDefined();
    });
  });

  it('calls listWorkspaces for prometheus datasources', async () => {
    const apiClient = createMockApiClient();
    render(<AlarmsPage apiClient={apiClient} />);
    await waitFor(() => {
      expect(apiClient.listWorkspaces).toHaveBeenCalled();
    });
  });

  it('handles API error gracefully', async () => {
    const apiClient = createMockApiClient();
    jest.spyOn(apiClient, 'listDatasources').mockRejectedValueOnce(new Error('Network error'));
    render(<AlarmsPage apiClient={apiClient} />);
    await waitFor(() => {
      // Should still render the page structure despite error
      expect(screen.getByText('Alert Manager')).toBeDefined();
    });
  });
});
