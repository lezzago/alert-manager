/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Coverage Gap Panel (Phase 6.1).
 *
 * Shows observability coverage summary and per-service gap analysis.
 * Intended for the Services tab.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  EuiFlexGroup,
  EuiFlexItem,
  EuiPanel,
  EuiText,
  EuiSpacer,
  EuiBadge,
  EuiButton,
  EuiStat,
  EuiLoadingSpinner,
  EuiBasicTable,
  EuiCallOut,
} from '@elastic/eui';
import type { AlarmsApiClient } from '../services/alarms_client';
import type {
  CoverageGapReport,
  ServiceCoverageGap,
  CoverageGapSeverity,
} from '../../common/root_cause_types';

interface CoverageGapPanelProps {
  apiClient: AlarmsApiClient;
  onServiceSelect?: (serviceName: string) => void;
}

const SEVERITY_COLORS: Record<CoverageGapSeverity, string> = {
  high: 'danger',
  medium: 'warning',
  low: 'hollow',
  none: 'secondary',
};

const SEVERITY_LABELS: Record<CoverageGapSeverity, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  none: 'Covered',
};

export const CoverageGapPanel: React.FC<CoverageGapPanelProps> = ({
  apiClient,
  onServiceSelect,
}) => {
  const [report, setReport] = useState<CoverageGapReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCoverageGaps = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await apiClient.getCoverageGaps();
    if ((r as any)._error) {
      setReport(null);
      setError((r as any)._errorMessage || 'Failed to load coverage analysis');
    } else {
      setReport(r);
    }
    setLoading(false);
  }, [apiClient]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiClient
      .getCoverageGaps()
      .then((r) => {
        if (cancelled) return;
        if ((r as any)._error) {
          setReport(null);
          setError((r as any)._errorMessage || 'Failed to load coverage analysis');
        } else {
          setReport(r);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient]);

  if (loading) {
    return (
      <EuiFlexGroup alignItems="center" gutterSize="s" data-test-subj="coverage-gap-loading">
        <EuiFlexItem grow={false}>
          <EuiLoadingSpinner size="m" />
        </EuiFlexItem>
        <EuiFlexItem>
          <EuiText size="s">Loading coverage analysis...</EuiText>
        </EuiFlexItem>
      </EuiFlexGroup>
    );
  }

  if (error) {
    return (
      <EuiCallOut title="Coverage analysis unavailable" color="danger" iconType="alert" size="s">
        <p>{error}</p>
        <EuiButton size="s" onClick={fetchCoverageGaps}>
          Retry
        </EuiButton>
      </EuiCallOut>
    );
  }

  if (!report || report.totalServices === 0) return null;

  const gapsToShow = report.gaps.filter((g) => g.gapSeverity !== 'none');

  const columns = [
    {
      field: 'serviceName',
      name: 'Service',
      sortable: true,
      render: (name: string) => (
        <span
          style={{
            cursor: onServiceSelect ? 'pointer' : 'default',
            color: onServiceSelect ? '#006BB4' : undefined,
          }}
          onClick={() => onServiceSelect?.(name)}
          data-test-subj={`coverage-gap-row-${name}`}
        >
          {name}
        </span>
      ),
    },
    {
      field: 'gapSeverity',
      name: 'Severity',
      width: '100px',
      render: (severity: CoverageGapSeverity, row: ServiceCoverageGap) => (
        <EuiBadge
          color={SEVERITY_COLORS[severity]}
          data-test-subj={`coverage-gap-severity-${row.serviceName}`}
        >
          {SEVERITY_LABELS[severity]}
        </EuiBadge>
      ),
    },
    {
      field: 'sloCount',
      name: 'SLOs',
      width: '70px',
    },
    {
      field: 'alertCount',
      name: 'Alerts',
      width: '70px',
    },
    {
      name: 'Missing',
      width: '200px',
      render: (row: ServiceCoverageGap) => {
        const missing: string[] = [];
        if (!row.hasSlos) missing.push('SLOs');
        if (row.uncoveredSignals.length > 0) missing.push(...row.uncoveredSignals);
        if (row.uncoveredDependencies.length > 0) {
          missing.push(`${row.uncoveredDependencies.length} dep SLOs`);
        }
        return missing.length > 0 ? (
          <EuiFlexGroup gutterSize="xs" wrap responsive={false}>
            {missing.map((m) => (
              <EuiFlexItem grow={false} key={m}>
                <EuiBadge color="hollow">{m}</EuiBadge>
              </EuiFlexItem>
            ))}
          </EuiFlexGroup>
        ) : (
          <EuiText size="xs" color="subdued">
            Fully covered
          </EuiText>
        );
      },
    },
  ];

  return (
    <EuiPanel paddingSize="m" hasBorder data-test-subj="coverage-gap-panel">
      <EuiFlexGroup gutterSize="l" responsive={false} data-test-subj="coverage-gap-summary">
        <EuiFlexItem>
          <EuiStat
            title={`${report.sloCoveragePercent}%`}
            description="SLO coverage"
            titleSize="s"
            titleColor={report.sloCoveragePercent >= 80 ? 'secondary' : 'danger'}
          />
        </EuiFlexItem>
        <EuiFlexItem>
          <EuiStat
            title={`${report.servicesWithoutAnyCoverage}`}
            description="Uncovered services"
            titleSize="s"
            titleColor={report.servicesWithoutAnyCoverage === 0 ? 'secondary' : 'danger'}
          />
        </EuiFlexItem>
        <EuiFlexItem>
          <EuiStat title={`${report.totalServices}`} description="Total services" titleSize="s" />
        </EuiFlexItem>
      </EuiFlexGroup>

      {gapsToShow.length > 0 && (
        <>
          <EuiSpacer size="m" />
          <EuiText size="xs" color="subdued">
            Services with coverage gaps ({gapsToShow.length}):
          </EuiText>
          <EuiSpacer size="s" />
          <EuiBasicTable
            items={gapsToShow}
            columns={columns}
            compressed
            data-test-subj="coverage-gap-table"
          />
        </>
      )}
    </EuiPanel>
  );
};
