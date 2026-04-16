/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Alert Detail Flyout — drill-down view for a single alert
 * showing full context, labels, annotations, and actions.
 */
import React, { useState, useEffect } from 'react';
import {
  EuiFlyout,
  EuiFlyoutHeader,
  EuiFlyoutBody,
  EuiFlyoutFooter,
  EuiTitle,
  EuiText,
  EuiSpacer,
  EuiBadge,
  EuiHealth,
  EuiFlexGroup,
  EuiFlexItem,
  EuiButton,
  EuiButtonEmpty,
  EuiPanel,
  EuiDescriptionList,
  EuiAccordion,
  EuiCodeBlock,
  EuiIcon,
  EuiToolTip,
  EuiLink,
} from '@elastic/eui';
import { UnifiedAlert, Datasource } from '../../common';
import { AlarmsApiClient } from '../services/alarms_client';
import type { NavigationService } from '../services/navigation_service';
import { AlertCorrelationPanel } from './alert_correlation_panel';
import { RootCauseAnalysisPanel } from './root_cause_analysis_panel';

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'danger',
  high: 'warning',
  medium: 'primary',
  low: 'subdued',
  info: 'default',
};
const STATE_COLORS: Record<string, string> = {
  active: 'danger',
  pending: 'warning',
  acknowledged: 'primary',
  resolved: 'success',
  error: 'danger',
};

/** Internal label keys filtered from the Labels accordion display. */
const INTERNAL_LABEL_KEYS = new Set([
  'monitor_id',
  'datasource_id',
  '_workspace',
  'monitor_type',
  'monitor_kind',
  'trigger_id',
  'trigger_name',
  'datasource_type',
]);

export interface AlertDetailFlyoutProps {
  alert: UnifiedAlert;
  datasources: Datasource[];
  apiClient: AlarmsApiClient;
  navigationService?: NavigationService;
  onClose: () => void;
  onAcknowledge: (alertId: string) => void;
  onSilence: (alertId: string) => void;
}

export const AlertDetailFlyout: React.FC<AlertDetailFlyoutProps> = ({
  alert,
  datasources,
  apiClient,
  navigationService,
  onClose,
  onAcknowledge,
  onSilence,
}) => {
  const [detailData, setDetailData] = useState<typeof alert | null>(null);

  // Fetch full detail (with raw data) from the API when flyout opens
  useEffect(() => {
    let cancelled = false;
    apiClient
      .getAlertDetail(alert.datasourceId, alert.id)
      .then((data: UnifiedAlert) => {
        if (!cancelled && data) setDetailData(data);
      })
      .catch((err: unknown) => {
        console.error('Failed to load alert details:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [alert.datasourceId, alert.id, apiClient]);

  // Merge detail data over summary — detail has `raw` and potentially richer labels
  const mergedAlert = detailData ? { ...alert, ...detailData } : alert;
  // Re-alias so the rest of the component works unchanged
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const alertData = mergedAlert;

  const dsName =
    datasources.find((d) => d.id === alert.datasourceId)?.name || alert.datasourceId || '\u2014';
  const allLabels = alertData.labels || {};
  // Filter out internal/system labels for display (fix S-m2/6)
  const labels = Object.fromEntries(
    Object.entries(allLabels).filter(([k]) => !INTERNAL_LABEL_KEYS.has(k))
  );
  const annotations = alertData.annotations || {};

  // Generate a mock AI analysis for the alert
  const aiAnalysis = getAlertAiAnalysis(alert);

  return (
    <EuiFlyout onClose={onClose} size="m" ownFocus aria-labelledby="alertDetailTitle">
      <EuiFlyoutHeader hasBorder>
        <EuiFlexGroup alignItems="center" justifyContent="spaceBetween" responsive={false}>
          <EuiFlexItem>
            <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
              <EuiFlexItem grow={false}>
                <EuiTitle size="m">
                  <h2 id="alertDetailTitle">{alert.name}</h2>
                </EuiTitle>
              </EuiFlexItem>
              {/* S-m8: Datasource type badge for visual distinction */}
              <EuiFlexItem grow={false}>
                <EuiBadge color={alert.datasourceType === 'opensearch' ? 'primary' : 'accent'}>
                  {alert.datasourceType === 'opensearch' ? 'OpenSearch' : 'Prometheus'}
                </EuiBadge>
              </EuiFlexItem>
            </EuiFlexGroup>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiFlexGroup gutterSize="xs" responsive={false}>
              <EuiFlexItem grow={false}>
                <EuiHealth color={STATE_COLORS[alert.state]}>{alert.state}</EuiHealth>
              </EuiFlexItem>
              <EuiFlexItem grow={false}>
                <EuiBadge color={SEVERITY_COLORS[alert.severity]}>{alert.severity}</EuiBadge>
              </EuiFlexItem>
            </EuiFlexGroup>
          </EuiFlexItem>
        </EuiFlexGroup>
        <EuiSpacer size="s" />
        {alert.message || annotations.summary || annotations.description ? (
          <EuiText size="s" color="subdued">
            {alert.message || annotations.summary || annotations.description}
          </EuiText>
        ) : (
          <EuiText size="s" color="subdued">
            Not available
          </EuiText>
        )}
      </EuiFlyoutHeader>

      <EuiFlyoutBody>
        {/* AI Analysis */}
        <EuiAccordion
          id={`alertAiAnalysis-${alert.id}`}
          buttonContent={
            <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
              <EuiFlexItem grow={false}>
                <EuiIcon type="compute" />
              </EuiFlexItem>
              <EuiFlexItem grow={false}>
                <strong>AI Analysis</strong>
              </EuiFlexItem>
              <EuiFlexItem grow={false}>
                <EuiBadge color="hollow">Beta</EuiBadge>
              </EuiFlexItem>
            </EuiFlexGroup>
          }
          initialIsOpen={true}
          paddingSize="m"
        >
          <EuiPanel color="subdued" paddingSize="m">
            <EuiText size="s">
              <p>{aiAnalysis}</p>
            </EuiText>
          </EuiPanel>
        </EuiAccordion>

        <EuiSpacer size="m" />

        {/* Alert Details */}
        <EuiAccordion
          id={`alertDetails-${alert.id}`}
          buttonContent={<strong>Alert Details</strong>}
          initialIsOpen={true}
          paddingSize="m"
        >
          <EuiDescriptionList
            type="column"
            compressed
            listItems={[
              { title: 'Alert ID', description: alert.id || '\u2014' },
              { title: 'State', description: alert.state || '\u2014' },
              { title: 'Severity', description: alert.severity || '\u2014' },
              { title: 'Backend', description: alert.datasourceType || '\u2014' },
              { title: 'Datasource', description: dsName },
              {
                title: 'Started',
                description: alert.startTime
                  ? new Date(alert.startTime).toLocaleString()
                  : '\u2014',
              },
              {
                title: 'Last Updated',
                description: alert.lastUpdated
                  ? new Date(alert.lastUpdated).toLocaleString()
                  : '\u2014',
              },
              { title: 'Duration', description: getAlertDuration(alert.startTime) },
            ]}
          />
        </EuiAccordion>

        <EuiSpacer size="m" />

        {/* Cross-Signal Correlations (Phase 3) — shown when alert has a service label */}
        {alertData.labels?.service && (
          <>
            <EuiAccordion
              id={`alertCorrelations-${alert.id}`}
              buttonContent={
                <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
                  <EuiFlexItem grow={false}>
                    <EuiIcon type="crosshairs" />
                  </EuiFlexItem>
                  <EuiFlexItem grow={false}>
                    <strong>Cross-Signal Correlations</strong>
                  </EuiFlexItem>
                  <EuiFlexItem grow={false}>
                    <EuiBadge color="hollow">{alertData.labels.service}</EuiBadge>
                  </EuiFlexItem>
                </EuiFlexGroup>
              }
              initialIsOpen={true}
              paddingSize="m"
            >
              <AlertCorrelationPanel
                alert={alertData}
                apiClient={apiClient}
                navigationService={navigationService}
              />
            </EuiAccordion>
            <EuiSpacer size="m" />

            {/* Root Cause Analysis (Phase 6.2) */}
            <EuiAccordion
              id={`alertRca-${alert.id}`}
              buttonContent={
                <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
                  <EuiFlexItem grow={false}>
                    <EuiIcon type="inspect" />
                  </EuiFlexItem>
                  <EuiFlexItem grow={false}>
                    <strong>Root Cause Analysis</strong>
                  </EuiFlexItem>
                </EuiFlexGroup>
              }
              initialIsOpen={true}
              paddingSize="m"
            >
              <RootCauseAnalysisPanel alert={alertData} apiClient={apiClient} />
            </EuiAccordion>
            <EuiSpacer size="m" />
          </>
        )}

        {/* Labels (internal keys filtered — see INTERNAL_LABEL_KEYS) */}
        <EuiAccordion
          id={`alertLabels-${alert.id}`}
          buttonContent={<strong>Labels ({Object.keys(labels).length})</strong>}
          initialIsOpen={true}
          paddingSize="m"
        >
          {Object.keys(labels).length > 0 ? (
            <EuiFlexGroup gutterSize="xs" wrap responsive={false}>
              {Object.entries(labels).map(([k, v]) => (
                <EuiFlexItem grow={false} key={k}>
                  <EuiBadge color="hollow">
                    {k}: {v || '\u2014'}
                  </EuiBadge>
                </EuiFlexItem>
              ))}
            </EuiFlexGroup>
          ) : (
            <EuiText size="s" color="subdued">
              Not available
            </EuiText>
          )}
        </EuiAccordion>

        <EuiSpacer size="m" />

        {/* Annotations */}
        <EuiAccordion
          id={`alertAnnotations-${alert.id}`}
          buttonContent={<strong>Annotations ({Object.keys(annotations).length})</strong>}
          initialIsOpen={true}
          paddingSize="m"
        >
          {Object.keys(annotations).length > 0 ? (
            <EuiDescriptionList
              type="column"
              compressed
              listItems={Object.entries(annotations).map(([k, v]) => ({
                title: k,
                description: v || '\u2014',
              }))}
            />
          ) : (
            <EuiText size="s" color="subdued">
              Not available
            </EuiText>
          )}
        </EuiAccordion>

        <EuiSpacer size="m" />

        {/* Suppression Status */}
        <EuiAccordion
          id={`suppressionStatus-${alert.id}`}
          buttonContent={
            <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
              <EuiFlexItem grow={false}>
                <EuiIcon type="bellSlash" />
              </EuiFlexItem>
              <EuiFlexItem grow={false}>
                <strong>Suppression Status</strong>
              </EuiFlexItem>
            </EuiFlexGroup>
          }
          initialIsOpen={false}
          paddingSize="m"
        >
          {alert.state === 'resolved' ? (
            <EuiPanel color="subdued" paddingSize="s">
              <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
                <EuiFlexItem grow={false}>
                  <EuiBadge color="default">Silenced</EuiBadge>
                </EuiFlexItem>
                <EuiFlexItem>
                  <EuiText size="xs" color="subdued">
                    This alert has been silenced or resolved.
                  </EuiText>
                </EuiFlexItem>
              </EuiFlexGroup>
            </EuiPanel>
          ) : (
            <EuiText size="s" color="subdued">
              No active suppression rules affecting this alert.
            </EuiText>
          )}
        </EuiAccordion>

        <EuiSpacer size="m" />

        {/* Routing Information */}
        <EuiAccordion
          id={`routingInfo-${alert.id}`}
          buttonContent={
            <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
              <EuiFlexItem grow={false}>
                <EuiIcon type="bell" />
              </EuiFlexItem>
              <EuiFlexItem grow={false}>
                <strong>Notification Routing</strong>
              </EuiFlexItem>
            </EuiFlexGroup>
          }
          initialIsOpen={false}
          paddingSize="m"
        >
          <EuiText size="s" color="subdued">
            Routing is determined by the monitor's notification configuration and matching routing
            rules. Check the associated monitor's detail view for full routing setup.
          </EuiText>
          {alert.labels.service && (
            <EuiPanel color="subdued" paddingSize="s" style={{ marginTop: 8 }}>
              <EuiText size="xs">
                Service: <EuiBadge color="hollow">{alert.labels.service}</EuiBadge>
                {alert.labels.team && (
                  <>
                    {' '}
                    | Team: <EuiBadge color="hollow">{alert.labels.team}</EuiBadge>
                  </>
                )}
              </EuiText>
            </EuiPanel>
          )}
        </EuiAccordion>

        <EuiSpacer size="m" />

        {/* Raw Data */}
        <EuiAccordion
          id={`alertRaw-${alert.id}`}
          buttonContent={<strong>Raw Alert Data</strong>}
          initialIsOpen={false}
          paddingSize="m"
        >
          <EuiCodeBlock language="json" fontSize="s" paddingSize="m" isCopyable>
            {JSON.stringify(alertData.raw ?? alert, null, 2)}
          </EuiCodeBlock>
        </EuiAccordion>

        <EuiSpacer size="m" />

        {/* Suggested Actions (S-m4: interactive where possible) */}
        <EuiAccordion
          id={`suggestedActions-${alert.id}`}
          buttonContent={
            <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
              <EuiFlexItem grow={false}>
                <EuiIcon type="sparkles" />
              </EuiFlexItem>
              <EuiFlexItem grow={false}>
                <strong>Suggested Actions</strong>
              </EuiFlexItem>
            </EuiFlexGroup>
          }
          initialIsOpen={true}
          paddingSize="m"
        >
          {getSuggestedActions(alert).map((action, i) => {
            // Determine interactivity: acknowledge action is clickable,
            // URL-containing actions link out, others are manual.
            const isAcknowledge = action.actionType === 'acknowledge';
            const isSilence = action.actionType === 'silence';
            const hasUrl = action.url !== undefined;
            const isClickable = isAcknowledge || isSilence || hasUrl;

            const handleClick = () => {
              if (isAcknowledge) onAcknowledge(alert.id);
              else if (isSilence) onSilence(alert.id);
            };

            return (
              <EuiPanel
                key={i}
                paddingSize="s"
                color="subdued"
                style={{
                  marginBottom: 6,
                  cursor: isClickable ? 'pointer' : 'default',
                }}
                onClick={isClickable && !hasUrl ? handleClick : undefined}
              >
                <EuiFlexGroup alignItems="center" responsive={false} gutterSize="s">
                  <EuiFlexItem grow={false}>
                    <EuiIcon type={action.icon} color={action.color} />
                  </EuiFlexItem>
                  <EuiFlexItem>
                    {hasUrl ? (
                      <EuiLink href={action.url} target="_blank">
                        <EuiText size="s">
                          <strong>{action.title}</strong>
                        </EuiText>
                      </EuiLink>
                    ) : (
                      <EuiText size="s">
                        <strong>{action.title}</strong>
                      </EuiText>
                    )}
                    <EuiText size="xs" color="subdued">
                      {action.description}
                      {!isClickable && (
                        <em style={{ marginLeft: 4 }}> &mdash; Manual action required</em>
                      )}
                    </EuiText>
                  </EuiFlexItem>
                  {isClickable && !hasUrl && (
                    <EuiFlexItem grow={false}>
                      <EuiIcon type="arrowRight" size="s" />
                    </EuiFlexItem>
                  )}
                </EuiFlexGroup>
              </EuiPanel>
            );
          })}
        </EuiAccordion>
      </EuiFlyoutBody>

      <EuiFlyoutFooter>
        <EuiFlexGroup justifyContent="spaceBetween" responsive={false}>
          <EuiFlexItem grow={false}>
            <EuiButtonEmpty onClick={onClose}>Close</EuiButtonEmpty>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiFlexGroup gutterSize="s" responsive={false}>
              <EuiFlexItem grow={false}>
                <EuiButton size="s" iconType="bellSlash" onClick={() => onSilence(alert.id)}>
                  Silence
                </EuiButton>
              </EuiFlexItem>
              {/* S-C4: Hide Acknowledge for Prometheus alerts — not supported */}
              {alert.state === 'active' && alert.datasourceType !== 'prometheus' && (
                <EuiFlexItem grow={false}>
                  <EuiButton fill size="s" iconType="check" onClick={() => onAcknowledge(alert.id)}>
                    Acknowledge
                  </EuiButton>
                </EuiFlexItem>
              )}
              {alert.state === 'active' && alert.datasourceType === 'prometheus' && (
                <EuiFlexItem grow={false}>
                  <EuiToolTip content="Acknowledgement not supported for Prometheus alerts — use Silence instead">
                    <EuiButton fill size="s" iconType="check" isDisabled>
                      Acknowledge
                    </EuiButton>
                  </EuiToolTip>
                </EuiFlexItem>
              )}
            </EuiFlexGroup>
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiFlyoutFooter>
    </EuiFlyout>
  );
};

// ============================================================================
// Helpers
// ============================================================================

function getAlertDuration(startTime: string): string {
  if (!startTime) return '—';
  const ms = Date.now() - new Date(startTime).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function getAlertAiAnalysis(alert: UnifiedAlert): string {
  const analyses: Record<string, string> = {
    HighCpuUsage:
      'This host (i-0abc123) has sustained CPU usage above 80% for the past 5 minutes, currently at 92.3%. The spike correlates with increased request traffic. Consider scaling horizontally or investigating the workload causing the spike. Historical data shows this host has been consistently hot for 2 days.',
    HighMemoryUsage:
      'Critical memory pressure detected on i-0def456 at 94.7%. This pattern is consistent with a memory leak — heap usage has been growing ~2% per hour. Immediate action recommended: restart the application and investigate the leak. OOM kill risk is high within the next 2 hours.',
    DiskSpaceLow:
      'Disk space on i-0ghi789 is at 12.1% available. This is a staging environment where test data accumulates. The weekly cleanup job should resolve this automatically. If urgent, manually trigger the cleanup or expand the volume.',
    HighErrorRate:
      'HTTP 5xx error rate is at 8.2%, well above the 5% threshold. The errors are concentrated in the api-gateway service and appear to be caused by connection pool exhaustion to the upstream backend. This started 5 minutes ago and is still climbing. Immediate investigation of the backend service health is recommended.',
    PodCrashLooping:
      'The order-service pod is crash looping with OOMKilled status. Current memory limit is 512Mi but the service requires ~600Mi under load. Recommend increasing the memory limit to 768Mi in the deployment spec. 3 restarts in the last 15 minutes.',
    CertificateExpiringSoon:
      'The TLS certificate for api.example.com expires in 22 days. Auto-renewal via cert-manager has failed twice. Check the DNS-01 challenge configuration and cert-manager logs. Manual renewal may be needed as a fallback.',
  };
  return (
    analyses[alert.name] ||
    `Alert "${alert.name}" is currently ${alert.state} with ${
      alert.severity
    } severity. Started ${getAlertDuration(
      alert.startTime
    )} ago. Review the labels and annotations for additional context on the root cause.`
  );
}

interface SuggestedAction {
  title: string;
  description: string;
  icon: string;
  color: string;
  /** Identifies the action type so the UI can make it interactive. */
  actionType: 'acknowledge' | 'silence' | 'link' | 'manual';
  /** Optional URL for link-type actions. */
  url?: string;
}

function getSuggestedActions(alert: UnifiedAlert): SuggestedAction[] {
  const actions: SuggestedAction[] = [];

  if (alert.state === 'active') {
    actions.push({
      title: 'Acknowledge this alert',
      description: 'Mark as acknowledged to stop repeated notifications while you investigate.',
      icon: 'check',
      color: 'primary',
      actionType: alert.datasourceType === 'prometheus' ? 'manual' : 'acknowledge',
    });
  }

  if (alert.severity === 'critical' || alert.severity === 'high') {
    const runbookUrl = alert.annotations?.runbook_url;
    actions.push({
      title: 'Check related runbook',
      description: runbookUrl || 'No runbook URL configured \u2014 consider adding one.',
      icon: 'document',
      color: 'warning',
      actionType: runbookUrl ? 'link' : 'manual',
      url: runbookUrl || undefined,
    });
  }

  if (alert.labels?.instance) {
    actions.push({
      title: `Investigate host ${alert.labels.instance}`,
      description: 'Open host metrics dashboard to correlate with other system indicators.',
      icon: 'compute',
      color: 'default',
      actionType: 'manual',
    });
  }

  if (alert.labels?.service) {
    actions.push({
      title: `View ${alert.labels.service} in APM`,
      description: 'Open APM service details with traces, metrics, and dependency map.',
      icon: 'popout',
      color: 'primary',
      actionType: 'link',
      url: `/app/observability-traces#/services/${encodeURIComponent(alert.labels.service)}`,
    });
  }

  actions.push({
    title: 'Silence for maintenance',
    description: 'Create a temporary silence rule if this alert is expected during maintenance.',
    icon: 'bellSlash',
    color: 'subdued',
    actionType: 'silence',
  });

  return actions;
}
