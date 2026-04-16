/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen, waitFor, configure } from '@testing-library/react';
import { CoverageGapPanel } from '../coverage_gap_panel';
import type { CoverageGapReport } from '../../../common/root_cause_types';

configure({ testIdAttribute: 'data-test-subj' });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReport(overrides: Partial<CoverageGapReport> = {}): CoverageGapReport {
  return {
    totalServices: 8,
    servicesWithSlos: 5,
    servicesWithAlerts: 3,
    servicesWithoutAnyCoverage: 2,
    sloCoveragePercent: 63,
    alertCoveragePercent: 38,
    gaps: [
      {
        serviceName: 'postgres',
        hasSlos: false,
        sloCount: 0,
        hasAlerts: false,
        alertCount: 0,
        hasTraces: false,
        hasLogs: false,
        hasMetrics: false,
        uncoveredSignals: [],
        uncoveredDependencies: [],
        gapSeverity: 'high',
      },
      {
        serviceName: 'notification-service',
        hasSlos: false,
        sloCount: 0,
        hasAlerts: false,
        alertCount: 0,
        hasTraces: true,
        hasLogs: true,
        hasMetrics: true,
        uncoveredSignals: ['traces', 'logs', 'metrics'],
        uncoveredDependencies: [],
        gapSeverity: 'high',
      },
      {
        serviceName: 'api-gateway',
        hasSlos: true,
        sloCount: 2,
        hasAlerts: true,
        alertCount: 1,
        hasTraces: true,
        hasLogs: true,
        hasMetrics: true,
        uncoveredSignals: [],
        uncoveredDependencies: [],
        gapSeverity: 'none',
      },
    ],
    computedAt: new Date().toISOString(),
    ...overrides,
  };
}

function createMockApiClient(report?: CoverageGapReport) {
  return {
    getCoverageGaps: jest.fn().mockResolvedValue(report ?? makeReport()),
  } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CoverageGapPanel', () => {
  it('shows loading spinner initially', () => {
    const apiClient = {
      getCoverageGaps: jest.fn().mockReturnValue(new Promise(() => {})),
    } as any;
    render(<CoverageGapPanel apiClient={apiClient} />);
    expect(screen.getByTestId('coverage-gap-loading')).toBeTruthy();
  });

  it('renders summary stats after data loads', async () => {
    const apiClient = createMockApiClient();
    render(<CoverageGapPanel apiClient={apiClient} />);
    await waitFor(() => {
      expect(screen.getByTestId('coverage-gap-summary')).toBeTruthy();
    });
  });

  it('shows coverage gap table with gaps', async () => {
    const apiClient = createMockApiClient();
    render(<CoverageGapPanel apiClient={apiClient} />);
    await waitFor(() => {
      expect(screen.getByTestId('coverage-gap-table')).toBeTruthy();
    });
  });

  it('does not render when no services', async () => {
    const emptyReport = makeReport({ totalServices: 0, gaps: [] });
    const apiClient = createMockApiClient(emptyReport);
    const { container } = render(<CoverageGapPanel apiClient={apiClient} />);
    await waitFor(() => {
      // Loading should finish
      expect(screen.queryByTestId('coverage-gap-loading')).toBeNull();
    });
    // Panel should not render
    expect(screen.queryByTestId('coverage-gap-panel')).toBeNull();
  });
});
