/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Root Cause Analysis Panel (Phase 6.2).
 *
 * Shown in alert detail flyout when an alert has a service label.
 * Displays a narrative, evidence list, dependency alerts, and suggested actions.
 */

import React, { useState, useEffect } from 'react';
import {
  EuiText,
  EuiSpacer,
  EuiBadge,
  EuiFlexGroup,
  EuiFlexItem,
  EuiLoadingSpinner,
  EuiCallOut,
  EuiPanel,
} from '@elastic/eui';
import type { AlarmsApiClient } from '../services/alarms_client';
import type { UnifiedAlertSummary } from '../../common/types';
import type { RootCauseAnalysis, RootCauseConfidence } from '../../common/root_cause_types';

interface RootCauseAnalysisPanelProps {
  alert: UnifiedAlertSummary;
  apiClient: AlarmsApiClient;
}

const CONFIDENCE_COLORS: Record<RootCauseConfidence, string> = {
  high: 'success',
  medium: 'warning',
  low: 'hollow',
};

export const RootCauseAnalysisPanel: React.FC<RootCauseAnalysisPanelProps> = ({
  alert,
  apiClient,
}) => {
  const [analysis, setAnalysis] = useState<RootCauseAnalysis | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiClient
      .getRootCauseAnalysis(alert)
      .then((result) => {
        if (!cancelled) setAnalysis(result);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [alert.id]);

  if (loading) {
    return (
      <EuiFlexGroup alignItems="center" gutterSize="s" data-test-subj="rca-loading">
        <EuiFlexItem grow={false}>
          <EuiLoadingSpinner size="m" />
        </EuiFlexItem>
        <EuiFlexItem>
          <EuiText size="s">Analyzing root cause...</EuiText>
        </EuiFlexItem>
      </EuiFlexGroup>
    );
  }

  if (!analysis) return null;

  return (
    <div data-test-subj="rca-panel">
      {/* Narrative */}
      <EuiCallOut
        title={
          <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
            <EuiFlexItem grow={false}>
              <strong>Analysis</strong>
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <EuiBadge
                color={CONFIDENCE_COLORS[analysis.confidence]}
                data-test-subj="rca-confidence-badge"
              >
                {analysis.confidence} confidence
              </EuiBadge>
            </EuiFlexItem>
          </EuiFlexGroup>
        }
        color={
          analysis.confidence === 'high'
            ? 'success'
            : analysis.confidence === 'medium'
              ? 'warning'
              : 'primary'
        }
        size="s"
      >
        <EuiText size="s" data-test-subj="rca-narrative">
          {analysis.narrative}
        </EuiText>
      </EuiCallOut>

      {/* Root Service */}
      {analysis.rootService && (
        <>
          <EuiSpacer size="s" />
          <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
            <EuiFlexItem grow={false}>
              <EuiText size="xs" color="subdued">
                Likely root cause:
              </EuiText>
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <EuiBadge color="danger" data-test-subj="rca-root-service">
                {analysis.rootService}
              </EuiBadge>
            </EuiFlexItem>
          </EuiFlexGroup>
        </>
      )}

      {/* Dependency Alerts */}
      {analysis.dependencyAlerts.length > 0 && (
        <>
          <EuiSpacer size="s" />
          <EuiText size="xs" color="subdued">
            Alerting dependencies:
          </EuiText>
          <EuiSpacer size="xs" />
          <EuiFlexGroup
            gutterSize="xs"
            wrap
            responsive={false}
            data-test-subj="rca-dependency-list"
          >
            {analysis.dependencyAlerts.map((dep) => (
              <EuiFlexItem grow={false} key={dep.serviceName}>
                <EuiBadge color="warning" data-test-subj={`rca-dependency-${dep.serviceName}`}>
                  {dep.serviceName} ({dep.alertCount} alert{dep.alertCount !== 1 ? 's' : ''})
                </EuiBadge>
              </EuiFlexItem>
            ))}
          </EuiFlexGroup>
        </>
      )}

      {/* Evidence */}
      {analysis.evidence.length > 0 && (
        <>
          <EuiSpacer size="s" />
          <EuiText size="xs" color="subdued">
            Evidence:
          </EuiText>
          <EuiSpacer size="xs" />
          <EuiPanel paddingSize="s" hasBorder color="subdued" data-test-subj="rca-evidence-list">
            {analysis.evidence.map((ev, i) => (
              <EuiText size="xs" key={i} style={{ marginBottom: 4 }}>
                <EuiBadge color="hollow" style={{ marginRight: 6 }}>
                  {ev.type.replace(/_/g, ' ')}
                </EuiBadge>
                {ev.summary}
              </EuiText>
            ))}
          </EuiPanel>
        </>
      )}

      {/* Suggested Actions */}
      {analysis.suggestedActions.length > 0 && (
        <>
          <EuiSpacer size="s" />
          <EuiText size="xs" color="subdued">
            Suggested next steps:
          </EuiText>
          <EuiSpacer size="xs" />
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {analysis.suggestedActions.map((action, i) => (
              <li key={i}>
                <EuiText size="xs" data-test-subj={`rca-action-${i}`}>
                  {action}
                </EuiText>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
};
