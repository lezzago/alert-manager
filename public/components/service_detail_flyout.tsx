/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
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
} from '@elastic/eui';
import type { EnrichedOtelService } from '../../common/types';

interface ServiceDetailFlyoutProps {
  service: EnrichedOtelService;
  onClose: () => void;
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

export const ServiceDetailFlyout: React.FC<ServiceDetailFlyoutProps> = ({ service, onClose }) => {
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

        {/* SLO Status */}
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
