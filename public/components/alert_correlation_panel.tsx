/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Alert Correlation Panel — shows correlated traces, logs, and metrics
 * from OTEL datasets for a given alert. Displayed as sub-tabs inside
 * the alert detail flyout.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  EuiTabs,
  EuiTab,
  EuiSpacer,
  EuiText,
  EuiLoadingSpinner,
  EuiEmptyPrompt,
  EuiBadge,
  EuiBasicTable,
  EuiFlexGroup,
  EuiFlexItem,
  EuiHealth,
  EuiPanel,
  EuiIcon,
  EuiToolTip,
} from '@elastic/eui';
import type {
  AlertCorrelationResult,
  CorrelatedTrace,
  CorrelatedLog,
  CorrelatedMetric,
  FailureMode,
  UnifiedAlertSummary,
} from '../../common/types';
import type { AlarmsApiClient } from '../services/alarms_client';

type SubTabId = 'traces' | 'logs' | 'metrics';

export interface AlertCorrelationPanelProps {
  alert: UnifiedAlertSummary;
  apiClient: AlarmsApiClient;
}

export const AlertCorrelationPanel: React.FC<AlertCorrelationPanelProps> = ({
  alert,
  apiClient,
}) => {
  const [activeTab, setActiveTab] = useState<SubTabId>('traces');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AlertCorrelationResult | null>(null);

  const fetchCorrelations = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiClient.getAlertCorrelations(alert);
      setData(result);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [alert.id, alert.labels?.service, apiClient]);

  useEffect(() => {
    if (alert.labels?.service) {
      fetchCorrelations();
    } else {
      setLoading(false);
    }
  }, [alert.labels?.service, fetchCorrelations]);

  if (!alert.labels?.service) {
    return (
      <EuiEmptyPrompt
        iconType="crosshairs"
        title={<h3>No service label</h3>}
        body="Cross-signal correlation requires a 'service' label on the alert."
      />
    );
  }

  if (loading) {
    return (
      <EuiFlexGroup justifyContent="center" alignItems="center" style={{ minHeight: 120 }}>
        <EuiFlexItem grow={false}>
          <EuiLoadingSpinner size="l" />
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiText size="s" color="subdued">
            Loading correlations for {alert.labels.service}...
          </EuiText>
        </EuiFlexItem>
      </EuiFlexGroup>
    );
  }

  const tracesCount = data?.traces?.length ?? 0;
  const logsCount = data?.logs?.length ?? 0;
  const metricsCount = data?.metrics?.length ?? 0;

  const tabs: Array<{ id: SubTabId; name: string; count: number }> = [
    { id: 'traces', name: 'Traces', count: tracesCount },
    { id: 'logs', name: 'Logs', count: logsCount },
    { id: 'metrics', name: 'Metrics', count: metricsCount },
  ];

  return (
    <div data-test-subj="alertCorrelationPanel">
      {/* Failure modes summary */}
      {data && data.failureModes.length > 0 && (
        <>
          <FailureModesSummary failureModes={data.failureModes} />
          <EuiSpacer size="s" />
        </>
      )}

      {/* Sampling notice */}
      {data?.tracesSampled && (
        <>
          <EuiPanel color="warning" paddingSize="s">
            <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
              <EuiFlexItem grow={false}>
                <EuiIcon type="clock" color="warning" />
              </EuiFlexItem>
              <EuiFlexItem>
                <EuiText size="xs">
                  Long-running alert: traces sampled from start, middle, and recent windows.
                </EuiText>
              </EuiFlexItem>
            </EuiFlexGroup>
          </EuiPanel>
          <EuiSpacer size="s" />
        </>
      )}

      {/* Sub-tabs */}
      <EuiTabs size="s">
        {tabs.map((tab) => (
          <EuiTab
            key={tab.id}
            isSelected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            data-test-subj={`correlationTab-${tab.id}`}
          >
            {tab.name} ({tab.count})
          </EuiTab>
        ))}
      </EuiTabs>

      <EuiSpacer size="m" />

      {activeTab === 'traces' && <TracesSubTab traces={data?.traces ?? []} />}
      {activeTab === 'logs' && <LogsSubTab logs={data?.logs ?? []} />}
      {activeTab === 'metrics' && <MetricsSubTab metrics={data?.metrics ?? []} />}
    </div>
  );
};

// ============================================================================
// Sub-tab Components
// ============================================================================

const TracesSubTab: React.FC<{ traces: CorrelatedTrace[] }> = ({ traces }) => {
  if (traces.length === 0) {
    return (
      <EuiEmptyPrompt
        iconType="apmTrace"
        title={<h4>No error traces found</h4>}
        body="No error spans were found in the correlated time window."
      />
    );
  }

  const columns = [
    {
      field: 'operationName',
      name: 'Operation',
      truncateText: true,
      width: '25%',
    },
    {
      field: 'durationMs',
      name: 'Duration',
      width: '10%',
      render: (ms: number) => `${ms}ms`,
    },
    {
      field: 'startTime',
      name: 'Time',
      width: '20%',
      render: (t: string) => {
        try {
          return new Date(t).toLocaleTimeString();
        } catch {
          return t;
        }
      },
    },
    {
      field: 'attributes',
      name: 'Error',
      truncateText: true,
      render: (attrs: Record<string, string>) => {
        const msg =
          attrs?.['exception.message'] ||
          attrs?.['error.message'] ||
          attrs?.['otel.status_description'] ||
          '';
        return (
          <EuiToolTip content={msg}>
            <EuiText
              size="xs"
              style={{
                maxWidth: 250,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {msg || 'Error status'}
            </EuiText>
          </EuiToolTip>
        );
      },
    },
    {
      field: 'traceId',
      name: 'Trace ID',
      width: '15%',
      truncateText: true,
      render: (id: string) => (
        <EuiText size="xs" style={{ fontFamily: 'monospace' }}>
          {id.substring(0, 12)}...
        </EuiText>
      ),
    },
  ];

  return (
    <EuiBasicTable
      items={traces}
      columns={columns}
      data-test-subj="correlationTracesTable"
      compressed
    />
  );
};

const LogsSubTab: React.FC<{ logs: CorrelatedLog[] }> = ({ logs }) => {
  if (logs.length === 0) {
    return (
      <EuiEmptyPrompt
        iconType="logsApp"
        title={<h4>No error logs found</h4>}
        body="No ERROR or FATAL log entries were found in the correlated time window."
      />
    );
  }

  const columns = [
    {
      field: 'timestamp',
      name: 'Time',
      width: '15%',
      render: (t: string) => {
        try {
          return new Date(t).toLocaleTimeString();
        } catch {
          return t;
        }
      },
    },
    {
      field: 'severityText',
      name: 'Level',
      width: '10%',
      render: (sev: string) => (
        <EuiHealth color={sev === 'FATAL' ? 'danger' : 'warning'}>{sev}</EuiHealth>
      ),
    },
    {
      field: 'body',
      name: 'Message',
      truncateText: true,
      render: (body: string) => (
        <EuiToolTip content={body}>
          <EuiText
            size="xs"
            style={{
              maxWidth: 350,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {body}
          </EuiText>
        </EuiToolTip>
      ),
    },
    {
      field: 'traceId',
      name: 'Trace ID',
      width: '15%',
      render: (id: string | undefined) =>
        id ? (
          <EuiText size="xs" style={{ fontFamily: 'monospace' }}>
            {id.substring(0, 12)}...
          </EuiText>
        ) : (
          <EuiText size="xs" color="subdued">
            --
          </EuiText>
        ),
    },
  ];

  return (
    <EuiBasicTable
      items={logs}
      columns={columns}
      data-test-subj="correlationLogsTable"
      compressed
    />
  );
};

const MetricsSubTab: React.FC<{ metrics: CorrelatedMetric[] }> = ({ metrics }) => {
  if (metrics.length === 0) {
    return (
      <EuiEmptyPrompt
        iconType="visLine"
        title={<h4>No correlated metrics</h4>}
        body="No metric data available for the correlated time window."
      />
    );
  }

  return (
    <div data-test-subj="correlationMetricsList">
      {metrics.map((metric, i) => (
        <EuiPanel key={i} paddingSize="s" color="subdued" style={{ marginBottom: 8 }}>
          <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
            <EuiFlexItem grow={false}>
              <EuiIcon type="visLine" />
            </EuiFlexItem>
            <EuiFlexItem>
              <EuiText size="s">
                <strong>{metric.metricName}</strong>
              </EuiText>
              {metric.description && (
                <EuiText size="xs" color="subdued">
                  {metric.description}
                </EuiText>
              )}
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <EuiBadge color="hollow">{metric.dataPoints.length} points</EuiBadge>
            </EuiFlexItem>
          </EuiFlexGroup>
          {Object.keys(metric.labels).length > 0 && (
            <EuiFlexGroup gutterSize="xs" wrap responsive={false} style={{ marginTop: 4 }}>
              {Object.entries(metric.labels).map(([k, v]) => (
                <EuiFlexItem grow={false} key={k}>
                  <EuiBadge color="hollow">
                    {k}={v}
                  </EuiBadge>
                </EuiFlexItem>
              ))}
            </EuiFlexGroup>
          )}
        </EuiPanel>
      ))}
    </div>
  );
};

// ============================================================================
// Failure Modes Summary
// ============================================================================

const FailureModesSummary: React.FC<{ failureModes: FailureMode[] }> = ({ failureModes }) => (
  <EuiPanel color="danger" paddingSize="s" data-test-subj="failureModesSummary">
    <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
      <EuiFlexItem grow={false}>
        <EuiIcon type="alert" color="danger" />
      </EuiFlexItem>
      <EuiFlexItem>
        <EuiText size="s">
          <strong>Dominant Failure Modes</strong>
        </EuiText>
      </EuiFlexItem>
    </EuiFlexGroup>
    <EuiSpacer size="xs" />
    {failureModes.map((mode, i) => (
      <EuiPanel key={i} paddingSize="s" color="subdued" style={{ marginBottom: 4 }}>
        <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
          <EuiFlexItem grow={false}>
            <EuiBadge color="danger">{mode.percentage}%</EuiBadge>
          </EuiFlexItem>
          <EuiFlexItem>
            <EuiText size="xs">{mode.pattern}</EuiText>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiText size="xs" color="subdued">
              {mode.count} errors
            </EuiText>
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiPanel>
    ))}
  </EuiPanel>
);
