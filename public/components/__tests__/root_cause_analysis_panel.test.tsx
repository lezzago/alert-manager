/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen, waitFor, configure } from '@testing-library/react';
import { RootCauseAnalysisPanel } from '../root_cause_analysis_panel';
import type { RootCauseAnalysis } from '../../../common/root_cause_types';
import type { UnifiedAlertSummary } from '../../../common/types';

configure({ testIdAttribute: 'data-test-subj' });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAlert(overrides: Partial<UnifiedAlertSummary> = {}): UnifiedAlertSummary {
  return {
    id: 'alert-1',
    datasourceId: 'ds-1',
    datasourceType: 'prometheus',
    name: 'HighErrorRate',
    state: 'firing',
    severity: 'critical',
    startTime: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    labels: { service: 'payment-service' },
    annotations: {},
    ...overrides,
  };
}

function makeAnalysis(overrides: Partial<RootCauseAnalysis> = {}): RootCauseAnalysis {
  return {
    alertId: 'alert-1',
    serviceName: 'payment-service',
    narrative: '78% of errors on payment-service are "Connection refused to payment-db".',
    confidence: 'high',
    evidence: [
      {
        type: 'failure_mode',
        summary: '78% of errors: Connection refused to payment-db',
        serviceName: 'payment-service',
        reference: 'trace-1',
      },
    ],
    rootService: 'postgres',
    dependencyAlerts: [
      {
        serviceName: 'postgres',
        alertCount: 3,
        health: 'critical',
        failureModes: [],
      },
    ],
    suggestedActions: ['Investigate postgres first'],
    computedAt: new Date().toISOString(),
    ...overrides,
  };
}

function createMockApiClient(analysis?: RootCauseAnalysis) {
  return {
    getRootCauseAnalysis: jest.fn().mockResolvedValue(analysis ?? makeAnalysis()),
  } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RootCauseAnalysisPanel', () => {
  it('shows loading spinner initially', () => {
    const apiClient = {
      getRootCauseAnalysis: jest.fn().mockReturnValue(new Promise(() => {})),
    } as any;
    render(<RootCauseAnalysisPanel alert={makeAlert()} apiClient={apiClient} />);
    expect(screen.getByTestId('rca-loading')).toBeTruthy();
  });

  it('renders narrative after data loads', async () => {
    const apiClient = createMockApiClient();
    render(<RootCauseAnalysisPanel alert={makeAlert()} apiClient={apiClient} />);
    await waitFor(() => {
      expect(screen.getByTestId('rca-narrative')).toBeTruthy();
    });
    expect(screen.getByTestId('rca-narrative').textContent).toContain('78%');
  });

  it('shows confidence badge', async () => {
    const apiClient = createMockApiClient();
    render(<RootCauseAnalysisPanel alert={makeAlert()} apiClient={apiClient} />);
    await waitFor(() => {
      expect(screen.getByTestId('rca-confidence-badge')).toBeTruthy();
    });
    expect(screen.getByTestId('rca-confidence-badge').textContent).toContain('high');
  });

  it('shows root service badge', async () => {
    const apiClient = createMockApiClient();
    render(<RootCauseAnalysisPanel alert={makeAlert()} apiClient={apiClient} />);
    await waitFor(() => {
      expect(screen.getByTestId('rca-root-service')).toBeTruthy();
    });
    expect(screen.getByTestId('rca-root-service').textContent).toContain('postgres');
  });

  it('shows dependency alerts', async () => {
    const apiClient = createMockApiClient();
    render(<RootCauseAnalysisPanel alert={makeAlert()} apiClient={apiClient} />);
    await waitFor(() => {
      expect(screen.getByTestId('rca-dependency-postgres')).toBeTruthy();
    });
  });

  it('shows evidence list', async () => {
    const apiClient = createMockApiClient();
    render(<RootCauseAnalysisPanel alert={makeAlert()} apiClient={apiClient} />);
    await waitFor(() => {
      expect(screen.getByTestId('rca-evidence-list')).toBeTruthy();
    });
  });
});
