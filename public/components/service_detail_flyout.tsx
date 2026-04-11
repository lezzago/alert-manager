/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  EuiFlyout,
  EuiFlyoutHeader,
  EuiFlyoutBody,
  EuiFlyoutFooter,
  EuiTitle,
  EuiFlexGroup,
  EuiFlexItem,
  EuiText,
  EuiBadge,
  EuiSpacer,
  EuiPanel,
  EuiDescriptionList,
  EuiButtonEmpty,
  EuiButton,
  EuiEmptyPrompt,
  EuiLoadingSpinner,
} from '@elastic/eui';
import type { EnrichedOtelService } from '../../common/types';
import type { SloInput } from '../../common/slo_types';
import type { SloSuggestion } from '../../common/slo_suggestion_types';
import type { AlarmsApiClient } from '../services/alarms_client';

interface ServiceDetailFlyoutProps {
  service: EnrichedOtelService;
  onClose: () => void;
  apiClient: AlarmsApiClient;
  onCreateSlo?: (prefill: SloInput) => void;
}

const signalBadge = (label: string, active: boolean) => (
  <EuiBadge color={active ? 'primary' : 'hollow'} data-test-subj={`service-signal-${label}`}>
    {label}
  </EuiBadge>
);

const severityColor = (count: number): string => {
  if (count === 0) return '#017D73';
  if (count <= 2) return '#F5A700';
  return '#BD271E';
};

const confidenceColor = (confidence: string): string => {
  if (confidence === 'high') return 'success';
  if (confidence === 'medium') return 'warning';
  return 'default';
};

export const ServiceDetailFlyout: React.FC<ServiceDetailFlyoutProps> = ({
  service,
  onClose,
  apiClient,
  onCreateSlo,
}) => {
  const [suggestions, setSuggestions] = useState<SloSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(true);

  useEffect(() => {
    setSuggestionsLoading(true);
    apiClient
      .getSloSuggestions(service.name)
      .then((resp) => setSuggestions(resp.suggestions))
      .catch(() => setSuggestions([]))
      .finally(() => setSuggestionsLoading(false));
  }, [apiClient, service.name]);

  const detailItems = [
    { title: 'Environment', description: service.environment },
    { title: 'Type', description: service.type ?? 'Service' },
    { title: 'SDK Language', description: service.sdkLanguage ?? 'Unknown' },
    { title: 'Last Seen', description: new Date(service.lastSeen).toLocaleString() },
  ];

  return (
    <EuiFlyout onClose={onClose} size="m" ownFocus data-test-subj="service-detail-flyout">
      <EuiFlyoutHeader hasBorder>
        <EuiFlexGroup alignItems="center" gutterSize="m">
          <EuiFlexItem grow={false}>
            <EuiTitle size="m">
              <h2>{service.name}</h2>
            </EuiTitle>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiBadge color="hollow">{service.environment}</EuiBadge>
          </EuiFlexItem>
          {service.sdkLanguage && (
            <EuiFlexItem grow={false}>
              <EuiBadge color="default">{service.sdkLanguage}</EuiBadge>
            </EuiFlexItem>
          )}
        </EuiFlexGroup>
      </EuiFlyoutHeader>

      <EuiFlyoutBody>
        {/* Stats row */}
        <EuiFlexGroup gutterSize="l">
          <EuiFlexItem>
            <EuiText size="xs" color="subdued">
              SLOs
            </EuiText>
            <EuiText size="m">
              <strong>{service.sloCount}</strong>
            </EuiText>
          </EuiFlexItem>
          <EuiFlexItem>
            <EuiText size="xs" color="subdued">
              Active Alerts
            </EuiText>
            <EuiText size="m" style={{ color: severityColor(service.activeAlertCount) }}>
              <strong>{service.activeAlertCount}</strong>
            </EuiText>
          </EuiFlexItem>
          <EuiFlexItem>
            <EuiText size="xs" color="subdued">
              Error Budget
            </EuiText>
            <EuiText size="m">
              <strong>
                {service.worstErrorBudget !== undefined
                  ? `${(service.worstErrorBudget * 100).toFixed(1)}%`
                  : '--'}
              </strong>
            </EuiText>
          </EuiFlexItem>
        </EuiFlexGroup>

        <EuiSpacer size="m" />

        {/* Signals */}
        <EuiPanel paddingSize="m" hasBorder>
          <EuiText size="xs" color="subdued">
            <strong>Available Signals</strong>
          </EuiText>
          <EuiSpacer size="s" />
          <EuiFlexGroup gutterSize="s">
            <EuiFlexItem grow={false}>
              {signalBadge('Traces', service.signals.hasTraces)}
            </EuiFlexItem>
            <EuiFlexItem grow={false}>{signalBadge('Logs', service.signals.hasLogs)}</EuiFlexItem>
            <EuiFlexItem grow={false}>
              {signalBadge('Metrics', service.signals.hasMetrics)}
            </EuiFlexItem>
          </EuiFlexGroup>
        </EuiPanel>

        <EuiSpacer size="m" />

        {/* Service Details */}
        <EuiPanel paddingSize="m" hasBorder>
          <EuiText size="xs" color="subdued">
            <strong>Service Details</strong>
          </EuiText>
          <EuiSpacer size="s" />
          <EuiDescriptionList type="column" compressed listItems={detailItems} />
        </EuiPanel>

        <EuiSpacer size="m" />

        {/* Dependencies */}
        <EuiPanel paddingSize="m" hasBorder>
          <EuiText size="xs" color="subdued">
            <strong>Dependencies</strong>
          </EuiText>
          <EuiSpacer size="s" />
          {service.dependencies.length > 0 ? (
            <EuiFlexGroup gutterSize="xs" wrap>
              {service.dependencies.map((dep) => (
                <EuiFlexItem grow={false} key={dep}>
                  <EuiBadge color="hollow">{dep}</EuiBadge>
                </EuiFlexItem>
              ))}
            </EuiFlexGroup>
          ) : (
            <EuiText size="s" color="subdued">
              No dependencies detected
            </EuiText>
          )}
        </EuiPanel>

        <EuiSpacer size="m" />

        {/* SLO Coverage */}
        <EuiPanel paddingSize="m" hasBorder>
          <EuiText size="xs" color="subdued">
            <strong>SLO Coverage</strong>
          </EuiText>
          <EuiSpacer size="s" />
          {service.sloCount > 0 ? (
            <EuiText size="s">
              {service.sloCount} SLO{service.sloCount !== 1 ? 's' : ''} configured for this service.
            </EuiText>
          ) : (
            <EuiEmptyPrompt
              iconType="visGauge"
              titleSize="xs"
              title={<h3>No SLOs configured</h3>}
              body={<p>Create an SLO to start tracking reliability for this service.</p>}
            />
          )}
        </EuiPanel>

        <EuiSpacer size="m" />

        {/* Suggested SLOs */}
        <EuiPanel paddingSize="m" hasBorder data-test-subj="suggested-slos-panel">
          <EuiText size="xs" color="subdued">
            <strong>Suggested SLOs</strong>
          </EuiText>
          <EuiSpacer size="s" />
          {suggestionsLoading ? (
            <EuiFlexGroup justifyContent="center">
              <EuiFlexItem grow={false}>
                <EuiLoadingSpinner size="m" data-test-subj="suggestions-loading" />
              </EuiFlexItem>
            </EuiFlexGroup>
          ) : suggestions.length === 0 ? (
            <EuiText size="s" color="subdued" data-test-subj="no-suggestions">
              No suggestions available for this service.
            </EuiText>
          ) : (
            suggestions.map((s) => (
              <EuiPanel
                key={s.templateId}
                paddingSize="s"
                hasBorder
                color={s.alreadyCovered ? 'subdued' : 'plain'}
                style={{ marginBottom: 4, opacity: s.alreadyCovered ? 0.6 : 1 }}
                data-test-subj={`suggestion-card-${s.templateId}`}
              >
                <EuiFlexGroup alignItems="center" gutterSize="s" responsive={false}>
                  <EuiFlexItem>
                    <EuiText size="s">
                      <strong>{s.templateName}</strong>
                    </EuiText>
                    <EuiText size="xs" color="subdued">
                      {s.reason}
                    </EuiText>
                  </EuiFlexItem>
                  <EuiFlexItem grow={false}>
                    <EuiBadge
                      color={confidenceColor(s.confidence)}
                      data-test-subj={`suggestion-confidence-${s.templateId}`}
                    >
                      {s.confidence}
                    </EuiBadge>
                  </EuiFlexItem>
                  <EuiFlexItem grow={false}>
                    {s.alreadyCovered ? (
                      <EuiBadge
                        color="hollow"
                        data-test-subj={`suggestion-created-${s.templateId}`}
                      >
                        Created
                      </EuiBadge>
                    ) : (
                      <EuiButton
                        size="s"
                        onClick={() => onCreateSlo?.(s.prefilled)}
                        data-test-subj={`suggestion-create-${s.templateId}`}
                      >
                        Create
                      </EuiButton>
                    )}
                  </EuiFlexItem>
                </EuiFlexGroup>
              </EuiPanel>
            ))
          )}
        </EuiPanel>
      </EuiFlyoutBody>

      <EuiFlyoutFooter>
        <EuiFlexGroup justifyContent="spaceBetween">
          <EuiFlexItem grow={false}>
            <EuiButtonEmpty onClick={onClose}>Close</EuiButtonEmpty>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiButton
              fill
              iconType="popout"
              data-test-subj="service-view-in-apm"
              onClick={() => {
                // Deep link to APM service details will be added in Phase 4
                onClose();
              }}
            >
              View in APM
            </EuiButton>
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiFlyoutFooter>
    </EuiFlyout>
  );
};
