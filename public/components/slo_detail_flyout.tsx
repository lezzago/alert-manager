/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SLO Detail Flyout — drill-down view for a single SLO
 * showing live status, SLI configuration, burn rate tiers,
 * generated rules, and management actions.
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
  EuiFlexGroup,
  EuiFlexItem,
  EuiButton,
  EuiButtonEmpty,
  EuiPanel,
  EuiDescriptionList,
  EuiHorizontalRule,
  EuiConfirmModal,
  EuiBasicTable,
  EuiToolTip,
  EuiLoadingSpinner,
} from '@elastic/eui';
import type { SloSummary, SloDefinition, BurnRateConfig } from '../../common/slo_types';
import {
  SLO_STATUS_COLORS,
  SLI_TYPE_LABELS,
  formatPercentage,
  formatErrorBudget,
  attainmentColor,
  errorBudgetColor,
} from './shared_constants';
import { ErrorBudgetForecastBadge } from './error_budget_forecast_badge';

// ============================================================================
// Props
// ============================================================================

export interface SloDetailFlyoutProps {
  slo: SloSummary | null;
  onClose: () => void;
  apiClient: { getSlo: (id: string) => Promise<SloDefinition> };
  onDelete?: (id: string) => void;
}

// ============================================================================
// Component
// ============================================================================

export const SloDetailFlyout: React.FC<SloDetailFlyoutProps> = ({
  slo,
  onClose,
  apiClient,
  onDelete,
}) => {
  const [fullSlo, setFullSlo] = useState<SloDefinition | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Fetch full SLO details when slo.id changes.
  // Captures the SLO ID at fetch start to guard against stale responses
  // overwriting data when the flyout switches to a different SLO.
  useEffect(() => {
    if (!slo) return;

    let cancelled = false;
    const currentSloId = slo.id;
    setLoading(true);
    setError(null);

    apiClient
      .getSlo(slo.id)
      .then((data: SloDefinition) => {
        if (!cancelled && slo?.id === currentSloId) {
          setFullSlo(data);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled && slo?.id === currentSloId) {
          console.error('Failed to load SLO details:', err);
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [slo?.id, apiClient]);

  if (!slo) return null;

  const status = slo.status;
  const attainment = status?.attainment ?? 0;
  const budgetRemaining = status?.errorBudgetRemaining ?? 0;

  // ------------------------------------------------------------------
  // Handlers
  // ------------------------------------------------------------------

  const handleDelete = () => {
    setShowDeleteConfirm(false);
    if (onDelete) onDelete(slo.id);
  };

  // ------------------------------------------------------------------
  // Burn rate table columns
  // ------------------------------------------------------------------

  const burnRateColumns = [
    {
      field: 'shortWindow',
      name: 'Short Window',
      width: '90px',
    },
    {
      field: 'longWindow',
      name: 'Long Window',
      width: '90px',
    },
    {
      field: 'burnRateMultiplier',
      name: 'Multiplier',
      width: '80px',
      render: (val: number) => `${val}x`,
    },
    {
      field: 'severity',
      name: 'Severity',
      width: '90px',
      render: (val: string) => (
        <EuiBadge color={val === 'critical' ? 'danger' : 'warning'}>{val}</EuiBadge>
      ),
    },
    {
      field: 'forDuration',
      name: 'For',
      width: '60px',
    },
  ];

  // ------------------------------------------------------------------
  // Generated rules table columns
  // ------------------------------------------------------------------

  const generatedRuleColumns = [
    {
      field: 'name',
      name: 'Rule Name',
      render: (name: string) => (
        <EuiToolTip content={name}>
          <EuiText
            size="xs"
            style={{ fontFamily: 'monospace', wordBreak: 'break-all', fontSize: 11 }}
          >
            {name}
          </EuiText>
        </EuiToolTip>
      ),
    },
    {
      field: 'type',
      name: 'Type',
      width: '100px',
      render: (_: string, item: { name: string }) => {
        const isAlerting =
          item.name.startsWith('SLO_BurnRate') ||
          item.name.startsWith('SLO_SLIHealth') ||
          item.name.startsWith('SLO_Attainment') ||
          item.name.startsWith('SLO_Warning');
        return (
          <EuiBadge color={isAlerting ? 'accent' : 'primary'}>
            {isAlerting ? 'alerting' : 'recording'}
          </EuiBadge>
        );
      },
    },
  ];

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  return (
    <>
      <EuiFlyout onClose={onClose} size="m" ownFocus side="right" aria-labelledby="sloDetailTitle">
        <EuiFlyoutHeader hasBorder>
          <EuiFlexGroup alignItems="center" justifyContent="spaceBetween" responsive={false}>
            <EuiFlexItem>
              <EuiTitle size="m">
                <h2 id="sloDetailTitle">{slo.name}</h2>
              </EuiTitle>
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <EuiBadge color={SLO_STATUS_COLORS[status?.status ?? 'no_data']}>
                {status?.status ?? 'no_data'}
              </EuiBadge>
            </EuiFlexItem>
          </EuiFlexGroup>
          <EuiSpacer size="xs" />
          <EuiText size="s" color="subdued">
            {slo.serviceName}
            {slo.operationName ? ` — ${slo.operationName}` : ''}
          </EuiText>
        </EuiFlyoutHeader>

        <EuiFlyoutBody>
          {loading && (
            <EuiFlexGroup justifyContent="center" style={{ padding: 32 }}>
              <EuiFlexItem grow={false}>
                <EuiLoadingSpinner size="l" />
              </EuiFlexItem>
            </EuiFlexGroup>
          )}

          {error && (
            <EuiPanel color="danger" paddingSize="s">
              <EuiText size="s" color="danger">
                {error}
              </EuiText>
            </EuiPanel>
          )}

          {/* Stats Row */}
          <EuiFlexGroup gutterSize="l" wrap responsive={false}>
            <EuiFlexItem>
              <EuiText size="xs" color="subdued">
                Current Attainment
              </EuiText>
              <EuiText
                size="m"
                style={{
                  fontWeight: 700,
                  color: attainmentColor(attainment, slo.target),
                }}
              >
                {formatPercentage(attainment, 3)}
              </EuiText>
            </EuiFlexItem>
            <EuiFlexItem>
              <EuiText size="xs" color="subdued">
                Target
              </EuiText>
              <EuiText size="m" style={{ fontWeight: 700 }}>
                {formatPercentage(slo.target, 2)}
              </EuiText>
            </EuiFlexItem>
            <EuiFlexItem>
              <EuiText size="xs" color="subdued">
                Error Budget Remaining
              </EuiText>
              <EuiText
                size="m"
                style={{
                  fontWeight: 700,
                  color: errorBudgetColor(budgetRemaining),
                }}
              >
                {formatErrorBudget(budgetRemaining)}
              </EuiText>
            </EuiFlexItem>
            <EuiFlexItem>
              <EuiText size="xs" color="subdued">
                Window
              </EuiText>
              <EuiText size="m" style={{ fontWeight: 700 }}>
                {slo.window.duration}
              </EuiText>
            </EuiFlexItem>
          </EuiFlexGroup>

          {/* Error Budget Forecast (Phase 6.3) */}
          {fullSlo && status && (
            <>
              <EuiSpacer size="s" />
              <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
                <EuiFlexItem grow={false}>
                  <EuiText size="xs" color="subdued">
                    Forecast:
                  </EuiText>
                </EuiFlexItem>
                <EuiFlexItem grow={false}>
                  <ErrorBudgetForecastBadge status={status} slo={fullSlo} />
                </EuiFlexItem>
              </EuiFlexGroup>
            </>
          )}

          <EuiSpacer size="l" />
          <EuiHorizontalRule margin="none" />
          <EuiSpacer size="l" />

          {/* SLI Configuration */}
          <EuiPanel paddingSize="m" hasBorder>
            <EuiTitle size="xs">
              <h3>SLI Configuration</h3>
            </EuiTitle>
            <EuiSpacer size="s" />
            <EuiDescriptionList
              type="column"
              compressed
              listItems={[
                {
                  title: 'SLI Type',
                  description: SLI_TYPE_LABELS[slo.sliType] || slo.sliType,
                },
                {
                  title: 'Metric',
                  description: fullSlo?.sli.metric || '—',
                },
                {
                  title: 'Service',
                  description: fullSlo
                    ? `${fullSlo.sli.service.labelName}="${fullSlo.sli.service.labelValue}"`
                    : slo.serviceName,
                },
                {
                  title: 'Operation',
                  description: fullSlo
                    ? `${fullSlo.sli.operation.labelName}="${fullSlo.sli.operation.labelValue}"`
                    : slo.operationName,
                },
                ...(fullSlo?.sli.goodEventsFilter
                  ? [{ title: 'Good Events Filter', description: fullSlo.sli.goodEventsFilter }]
                  : []),
                ...(fullSlo?.sli.latencyThreshold !== undefined
                  ? [
                      {
                        title: 'Latency Threshold',
                        description: `${fullSlo.sli.latencyThreshold}s`,
                      },
                    ]
                  : []),
              ]}
            />
          </EuiPanel>

          <EuiSpacer size="m" />

          {/* Burn Rate Configuration */}
          <EuiPanel paddingSize="m" hasBorder>
            <EuiTitle size="xs">
              <h3>Burn Rate Configuration</h3>
            </EuiTitle>
            <EuiSpacer size="s" />
            {fullSlo?.burnRates && fullSlo.burnRates.length > 0 ? (
              <EuiBasicTable<BurnRateConfig>
                items={fullSlo.burnRates}
                columns={burnRateColumns}
                compressed
              />
            ) : (
              <EuiText size="s" color="subdued">
                {loading ? 'Loading...' : 'No burn rate tiers configured'}
              </EuiText>
            )}
          </EuiPanel>

          <EuiSpacer size="m" />

          {/* Generated Rules */}
          <EuiPanel paddingSize="m" hasBorder>
            <EuiTitle size="xs">
              <h3>
                Generated Rules{' '}
                {fullSlo?.generatedRuleNames && (
                  <EuiBadge color="hollow">{fullSlo.generatedRuleNames.length}</EuiBadge>
                )}
              </h3>
            </EuiTitle>
            <EuiSpacer size="s" />
            {fullSlo?.generatedRuleNames && fullSlo.generatedRuleNames.length > 0 ? (
              <EuiBasicTable
                items={fullSlo.generatedRuleNames.map((name) => ({ name }))}
                columns={generatedRuleColumns}
                compressed
              />
            ) : (
              <EuiText size="s" color="subdued">
                {loading ? 'Loading...' : 'No generated rules'}
              </EuiText>
            )}
          </EuiPanel>

          <EuiSpacer size="m" />

          {/* Tags */}
          {slo.tags && Object.keys(slo.tags).length > 0 && (
            <>
              <EuiPanel paddingSize="m" hasBorder>
                <EuiTitle size="xs">
                  <h3>Tags</h3>
                </EuiTitle>
                <EuiSpacer size="s" />
                <EuiFlexGroup gutterSize="xs" wrap responsive={false}>
                  {Object.entries(slo.tags).map(([k, v]) => (
                    <EuiFlexItem grow={false} key={k}>
                      <EuiBadge color="hollow">
                        {k}: {v}
                      </EuiBadge>
                    </EuiFlexItem>
                  ))}
                </EuiFlexGroup>
              </EuiPanel>
              <EuiSpacer size="m" />
            </>
          )}
        </EuiFlyoutBody>

        <EuiFlyoutFooter>
          <EuiFlexGroup justifyContent="spaceBetween" responsive={false}>
            <EuiFlexItem grow={false}>
              <EuiButtonEmpty onClick={onClose}>Close</EuiButtonEmpty>
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <EuiFlexGroup gutterSize="s" responsive={false}>
                <EuiFlexItem grow={false}>
                  <EuiToolTip content="Edit SLO (coming soon)">
                    <EuiButton size="s" iconType="pencil" isDisabled>
                      Edit
                    </EuiButton>
                  </EuiToolTip>
                </EuiFlexItem>
                {onDelete && (
                  <EuiFlexItem grow={false}>
                    <EuiButton
                      size="s"
                      color="danger"
                      iconType="trash"
                      onClick={() => setShowDeleteConfirm(true)}
                    >
                      Delete
                    </EuiButton>
                  </EuiFlexItem>
                )}
              </EuiFlexGroup>
            </EuiFlexItem>
          </EuiFlexGroup>
        </EuiFlyoutFooter>
      </EuiFlyout>

      {/* Delete confirmation modal */}
      {showDeleteConfirm && (
        <EuiConfirmModal
          title={`Delete SLO "${slo.name}"?`}
          onCancel={() => setShowDeleteConfirm(false)}
          onConfirm={handleDelete}
          cancelButtonText="Cancel"
          confirmButtonText="Delete"
          buttonColor="danger"
        >
          <EuiText size="s">
            <p>
              This will permanently delete the SLO definition and remove all generated Prometheus
              recording and alerting rules. This action cannot be undone.
            </p>
          </EuiText>
        </EuiConfirmModal>
      )}
    </>
  );
};
