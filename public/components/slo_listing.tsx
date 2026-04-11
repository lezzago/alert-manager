/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SLO Listing -- follows the same EuiResizableContainer + EuiBasicTable
 * pattern used by MonitorsTable (Rules tab) and AlertsDashboard (Alerts tab).
 *
 * Structural alignment with Rules tab:
 *  - Full-height EuiResizableContainer with filter + main panels
 *  - Filter panel: EuiPanel hasBorder, "Filters" header, collapsible facet
 *    groups with chevrons, EuiCheckbox compressed, count badges
 *  - Main panel: EuiPanel hasBorder wrapping Create button, search bar,
 *    stat cards, count row, and table
 *  - Single-line name column with truncation (operation in detail flyout)
 *  - Matching TablePagination from shared pattern
 *
 * ECharts visualizations follow the AlertsDashboard pattern:
 *  - Error Budget Burndown (full-width horizontal bar)
 *  - SLO Status Donut (matches SeverityDonut)
 *  - By SLI Type bar chart (matches AlertsByDatasource)
 *  - By Service bar chart (matches AlertsByMonitor)
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  EuiFlexGroup,
  EuiFlexItem,
  EuiPanel,
  EuiSpacer,
  EuiBadge,
  EuiBasicTable,
  EuiText,
  EuiButtonIcon,
  EuiToolTip,
  EuiFieldSearch,
  EuiEmptyPrompt,
  EuiButton,
  EuiLoadingSpinner,
  EuiCallOut,
  EuiHealth,
  EuiResizableContainer,
  EuiButtonEmpty,
  EuiTitle,
} from '@elastic/eui';
import { TablePagination } from './table_pagination';
import {
  SLI_TYPE_LABELS,
  formatPercentage,
  formatErrorBudget,
  errorBudgetColor,
  attainmentColor,
} from './shared_constants';
import type {
  SloSummary,
  SloDefinition,
  SloInput,
  SloStatus,
  SliType,
  SloLiveStatus,
  GeneratedRule,
} from '../../common/slo_types';
import { CreateSloWizard } from './create_slo_wizard';
import { SloDetailFlyout } from './slo_detail_flyout';
import { ErrorBudgetBurndown, SloStatusDonut, SlosBySliType, SlosByService } from './slo_charts';
import { SloSummaryCards } from './slo_summary_cards';
import { FacetFilterGroup, useFacetCollapse } from './facet_filter_panel';

// ============================================================================
// Types
// ============================================================================

/** Minimal API surface SLO components need from AlarmsApiClient. */
export interface SloApiClient {
  listSlos: () => Promise<{
    results: SloSummary[];
    total: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
  }>;
  getSlo: (id: string) => Promise<SloDefinition>;
  createSlo: (data: SloInput) => Promise<SloDefinition>;
  deleteSlo: (id: string) => Promise<{ deleted: boolean; generatedRuleNames: string[] }>;
}

interface SloListingProps {
  apiClient: SloApiClient;
  navigationService?: unknown; // NavigationService — typed as unknown to avoid circular import
  /** SLO ID from URL hash to auto-open detail flyout. */
  initialSloId?: string;
  /** Callback when an SLO is selected (updates URL hash). */
  onSloSelect?: (sloId: string) => void;
  /** Callback when SLO detail is closed (clears URL hash). */
  onSloClose?: () => void;
}

interface SloApiResponse {
  results: SloSummary[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// ============================================================================
// Table CSS (injected once, not per render)
// ============================================================================

const SLO_TABLE_CSS = `
  .slo-table-wrapper .euiTable { table-layout: auto; min-width: 100%; }
  .slo-table-wrapper .euiTableCellContent { white-space: nowrap; }
`;

// ============================================================================
// Status display map (mirrors STATUS_COLORS / HEALTH_COLORS in monitors_table)
// ============================================================================

const STATUS_HEALTH_COLORS: Record<string, string> = {
  breached: 'danger',
  warning: 'warning',
  ok: 'success',
  no_data: 'subdued',
};

// ============================================================================
// Custom Pagination (same pattern as monitors_table / alerts_dashboard)
// ============================================================================

// ============================================================================
// ExpandedRuleRow -- fetches full SLO and renders generated rules
// ============================================================================

const ExpandedRuleRow: React.FC<{ sloId: string; apiClient: SloApiClient }> = ({
  sloId,
  apiClient,
}) => {
  const [rules, setRules] = useState<GeneratedRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiClient.getSlo(sloId);
        if (cancelled) return;
        const { generateSloRuleGroup } = await import('../../common/slo_promql_generator');
        const ruleGroup = generateSloRuleGroup(data);
        setRules(ruleGroup.rules);
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load rules');
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [sloId, apiClient]);

  if (loading) {
    return (
      <div style={{ padding: '12px 16px', background: '#FAFBFD' }}>
        <EuiLoadingSpinner size="s" /> Loading rules...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '12px 16px', background: '#FAFBFD' }}>
        <EuiText size="xs" color="danger">
          {error}
        </EuiText>
      </div>
    );
  }

  if (rules.length === 0) {
    return (
      <div style={{ padding: '12px 16px', background: '#FAFBFD' }}>
        <EuiText size="xs" color="subdued">
          No generated rules found.
        </EuiText>
      </div>
    );
  }

  return (
    <div style={{ padding: '8px 16px 12px', background: '#FAFBFD' }}>
      <EuiText size="xs">
        <strong>Generated Rules ({rules.length})</strong>
      </EuiText>
      <EuiSpacer size="xs" />
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', minWidth: 600 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #D3DAE6' }}>
              <th
                style={{
                  padding: '4px 8px',
                  textAlign: 'left',
                  fontWeight: 600,
                  color: '#69707D',
                  width: 80,
                }}
              >
                Type
              </th>
              <th
                style={{ padding: '4px 8px', textAlign: 'left', fontWeight: 600, color: '#69707D' }}
              >
                Rule Name
              </th>
              <th
                style={{ padding: '4px 8px', textAlign: 'left', fontWeight: 600, color: '#69707D' }}
              >
                Description
              </th>
              <th
                style={{
                  padding: '4px 8px',
                  textAlign: 'left',
                  fontWeight: 600,
                  color: '#69707D',
                  width: 60,
                }}
              >
                Health
              </th>
              <th
                style={{
                  padding: '4px 8px',
                  textAlign: 'left',
                  fontWeight: 600,
                  color: '#69707D',
                  width: 50,
                }}
              >
                For
              </th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr key={`${rule.type}-${rule.name}`} style={{ borderBottom: '1px solid #EDF0F5' }}>
                <td style={{ padding: '4px 8px' }}>
                  <EuiBadge
                    color={
                      rule.type === 'alerting'
                        ? rule.labels?.severity === 'critical'
                          ? 'danger'
                          : 'warning'
                        : 'hollow'
                    }
                  >
                    {rule.type}
                  </EuiBadge>
                </td>
                <td style={{ padding: '4px 8px' }}>
                  <EuiToolTip content={rule.name}>
                    <span style={{ fontFamily: 'monospace', fontSize: 11, cursor: 'default' }}>
                      {rule.name}
                    </span>
                  </EuiToolTip>
                </td>
                <td style={{ padding: '4px 8px', color: '#69707D' }}>{rule.description}</td>
                <td style={{ padding: '4px 8px' }}>
                  <EuiHealth color="success">ok</EuiHealth>
                </td>
                <td style={{ padding: '4px 8px', color: '#69707D' }}>{rule.for || '\u2014'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ============================================================================
// SloListing -- main component
// ============================================================================

const SloListing: React.FC<SloListingProps> = ({
  apiClient,
  initialSloId,
  onSloSelect,
  onSloClose,
}) => {
  // State
  const [slos, setSlos] = useState<SloSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatuses, setSelectedStatuses] = useState<SloStatus[]>([]);
  const [selectedSliTypes, setSelectedSliTypes] = useState<SliType[]>([]);
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [selectedDatasources, setSelectedDatasources] = useState<string[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [expandedRowIds, setExpandedRowIds] = useState<Set<string>>(new Set());

  const [showCreateWizard, setShowCreateWizard] = useState(false);
  const [selectedSloId, setSelectedSloId] = useState<string | null>(null);

  // Collapsible facet sections state (shared hook)
  const { toggleFacetCollapse, isCollapsed: isFacetCollapsed } = useFacetCollapse();

  // Stat card filter
  const [statFilter, setStatFilter] = useState<string | null>(null);

  // Fetch SLOs
  const fetchSlos = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp: SloApiResponse = await apiClient.listSlos();
      setSlos(resp.results || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load SLOs');
      setSlos([]);
    } finally {
      setLoading(false);
    }
  }, [apiClient]);

  useEffect(() => {
    fetchSlos();
  }, [fetchSlos]);

  // Restore selected SLO from URL hash on mount
  useEffect(() => {
    if (initialSloId && !selectedSloId) {
      setSelectedSloId(initialSloId);
    }
    // Only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSloId]);

  // Derived filter values
  const allServices = useMemo(() => [...new Set(slos.map((s) => s.serviceName))].sort(), [slos]);
  const allSliTypes = useMemo(() => [...new Set(slos.map((s) => s.sliType))].sort(), [slos]);
  const allDatasources = useMemo(
    () => [...new Set(slos.map((s) => s.datasourceId))].sort(),
    [slos]
  );

  // Filter + search
  const filteredSlos = useMemo(() => {
    let result = slos;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.serviceName.toLowerCase().includes(q) ||
          s.operationName.toLowerCase().includes(q)
      );
    }
    if (selectedStatuses.length > 0) {
      result = result.filter((s) => selectedStatuses.includes(s.status.status));
    }
    if (selectedSliTypes.length > 0) {
      result = result.filter((s) => selectedSliTypes.includes(s.sliType));
    }
    if (selectedServices.length > 0) {
      result = result.filter((s) => selectedServices.includes(s.serviceName));
    }
    if (selectedDatasources.length > 0) {
      result = result.filter((s) => selectedDatasources.includes(s.datasourceId));
    }
    // Stat card filter
    if (statFilter && statFilter !== 'all') {
      result = result.filter((s) => s.status.status === statFilter);
    }
    return result;
  }, [
    slos,
    searchQuery,
    selectedStatuses,
    selectedSliTypes,
    selectedServices,
    selectedDatasources,
    statFilter,
  ]);

  // Pagination
  const paginatedSlos = useMemo(() => {
    const start = pageIndex * pageSize;
    return filteredSlos.slice(start, start + pageSize);
  }, [filteredSlos, pageIndex, pageSize]);

  // Status summary
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { breached: 0, warning: 0, ok: 0, no_data: 0 };
    for (const s of slos) counts[s.status.status] = (counts[s.status.status] || 0) + 1;
    return counts;
  }, [slos]);

  // Facet counts (for filters)
  const facetCounts = useMemo(() => {
    const sliType: Record<string, number> = {};
    const status: Record<string, number> = {};
    const service: Record<string, number> = {};
    const datasource: Record<string, number> = {};
    for (const s of slos) {
      sliType[s.sliType] = (sliType[s.sliType] || 0) + 1;
      status[s.status.status] = (status[s.status.status] || 0) + 1;
      service[s.serviceName] = (service[s.serviceName] || 0) + 1;
      datasource[s.datasourceId] = (datasource[s.datasourceId] || 0) + 1;
    }
    return { sliType, status, service, datasource };
  }, [slos]);

  // Active filter count
  const activeFilterCount =
    selectedStatuses.length +
    selectedSliTypes.length +
    selectedServices.length +
    selectedDatasources.length;

  // Clear all filters
  const clearAllFilters = () => {
    setSelectedStatuses([]);
    setSelectedSliTypes([]);
    setSelectedServices([]);
    setSelectedDatasources([]);
    setStatFilter(null);
  };

  // Expanded row map
  const itemIdToExpandedRowMap = useMemo(() => {
    const map: Record<string, React.ReactNode> = {};
    for (const slo of paginatedSlos) {
      if (expandedRowIds.has(slo.id)) {
        map[slo.id] = <ExpandedRuleRow sloId={slo.id} apiClient={apiClient} />;
      }
    }
    return map;
  }, [paginatedSlos, expandedRowIds, apiClient]);

  // Actions
  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await apiClient.deleteSlo(id);
        fetchSlos();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to delete SLO';
        setError(message);
      }
    },
    [apiClient, fetchSlos]
  );

  // ---- Columns (matching Rules table pattern -- single-line names) ----
  const columns = useMemo(
    () => [
      {
        field: 'id',
        name: '',
        width: '28px',
        render: (_: string, slo: SloSummary) => (
          <EuiButtonIcon
            aria-label={expandedRowIds.has(slo.id) ? 'Collapse' : 'Expand'}
            iconType={expandedRowIds.has(slo.id) ? 'arrowDown' : 'arrowRight'}
            onClick={() => {
              const next = new Set(expandedRowIds);
              next.has(slo.id) ? next.delete(slo.id) : next.add(slo.id);
              setExpandedRowIds(next);
            }}
            size="s"
            color="text"
          />
        ),
      },
      {
        field: 'name',
        name: 'Name',
        sortable: true,
        truncateText: true,
        render: (name: string, slo: SloSummary) => (
          <span
            role="button"
            tabIndex={0}
            style={{
              fontWeight: 500,
              color: '#006BB4',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: 'block',
            }}
            onClick={() => {
              setSelectedSloId(slo.id);
              onSloSelect?.(slo.id);
            }}
            onKeyDown={(e: React.KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setSelectedSloId(slo.id);
                onSloSelect?.(slo.id);
              }
            }}
            aria-label={`View details for ${name}`}
            title={name}
          >
            {name}
          </span>
        ),
      },
      {
        field: 'status',
        name: 'Status',
        sortable: true,
        width: '100px',
        render: (status: SloLiveStatus) => (
          <EuiHealth color={STATUS_HEALTH_COLORS[status.status] || 'subdued'}>
            {status.status}
          </EuiHealth>
        ),
      },
      {
        field: 'sliType',
        name: 'Type',
        sortable: true,
        width: '120px',
        render: (sliType: SliType) => (
          <EuiBadge color="hollow">{SLI_TYPE_LABELS[sliType] || sliType}</EuiBadge>
        ),
      },
      {
        field: 'status',
        name: 'Attainment',
        width: '90px',
        render: (status: SloLiveStatus, slo: SloSummary) => {
          if (!status || status.attainment === 0)
            return <span style={{ color: '#98A2B3' }}>{'\u2014'}</span>;
          const color = attainmentColor(status.attainment, slo.target);
          return (
            <span style={{ fontWeight: 600, color }}>{formatPercentage(status.attainment, 3)}</span>
          );
        },
      },
      {
        field: 'target',
        name: 'Goal',
        width: '60px',
        render: (target: number) => formatPercentage(target, 2),
      },
      {
        field: 'status',
        name: 'Budget',
        width: '130px',
        render: (status: SloLiveStatus) => {
          if (!status) return <span style={{ color: '#98A2B3' }}>{'\u2014'}</span>;
          const budget = status.errorBudgetRemaining;
          const color = errorBudgetColor(budget);
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
              <div
                style={{
                  width: 50,
                  height: 6,
                  background: '#EDF0F5',
                  borderRadius: 3,
                  overflow: 'hidden',
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${Math.max(0, Math.min(100, budget * 100))}%`,
                    background: color,
                    borderRadius: 3,
                  }}
                />
              </div>
              <span style={{ fontSize: 12, fontWeight: 600, color }}>
                {formatErrorBudget(budget)}
              </span>
            </div>
          );
        },
      },
      {
        field: 'serviceName',
        name: 'Service',
        sortable: true,
        truncateText: true,
      },
      {
        field: 'status',
        name: 'Rules',
        width: '120px',
        render: (status: SloLiveStatus) => {
          if (!status) return <span style={{ color: '#98A2B3' }}>{'\u2014'}</span>;
          const { ruleCount, firingCount } = status;
          if (firingCount > 0) {
            return (
              <EuiBadge color="danger">
                {ruleCount} rules &middot; {firingCount} firing
              </EuiBadge>
            );
          }
          return <EuiBadge color="success">{ruleCount} rules</EuiBadge>;
        },
      },
      {
        field: 'datasourceId',
        name: 'Backend',
        width: '90px',
        render: () => <EuiBadge color="accent">prometheus</EuiBadge>,
      },
    ],
    [expandedRowIds]
  );

  // ---- Filter panel facet group renderer (delegates to shared component) ----
  const renderFacetGroup = (
    id: string,
    label: string,
    options: string[],
    selected: string[],
    onChange: (v: string[]) => void,
    counts: Record<string, number>,
    displayMap?: Record<string, string>,
    colorMap?: Record<string, string>
  ) => (
    <FacetFilterGroup
      key={id}
      id={id}
      label={label}
      options={options}
      selected={selected}
      onChange={onChange}
      counts={counts}
      displayMap={displayMap}
      colorMap={colorMap}
      isCollapsed={isFacetCollapsed(id)}
      onToggleCollapse={toggleFacetCollapse}
    />
  );

  // ---- Render ----
  return (
    <>
      {/* Error callout */}
      {error && (
        <>
          <EuiCallOut title="Error loading SLOs" color="danger" iconType="alert">
            <p>{error}</p>
          </EuiCallOut>
          <EuiSpacer size="m" />
        </>
      )}

      {/* Full-height resizable container (same pattern as Rules tab) */}
      <EuiResizableContainer style={{ height: 'calc(100vh - 180px)' }}>
        {(EuiResizablePanel, EuiResizableButton) => (
          <>
            {/* ---- Filter Panel ---- */}
            <EuiResizablePanel
              id="slo-filters-panel"
              initialSize={20}
              minSize="200px"
              mode={['collapsible', { position: 'top' }]}
              onToggleCollapsed={() => {}}
              paddingSize="none"
              style={{ overflow: 'auto', paddingRight: '4px' }}
            >
              <EuiPanel
                paddingSize="s"
                hasBorder
                style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
              >
                <div style={{ flex: 1, overflow: 'auto' }}>
                  <EuiFlexGroup
                    gutterSize="xs"
                    alignItems="center"
                    responsive={false}
                    justifyContent="spaceBetween"
                  >
                    <EuiFlexItem>
                      <EuiText size="xs">
                        <strong>Filters</strong>
                      </EuiText>
                    </EuiFlexItem>
                    {activeFilterCount > 0 && (
                      <EuiFlexItem grow={false}>
                        <EuiButtonEmpty size="xs" onClick={clearAllFilters} flush="right">
                          Clear ({activeFilterCount})
                        </EuiButtonEmpty>
                      </EuiFlexItem>
                    )}
                  </EuiFlexGroup>
                  <EuiSpacer size="s" />

                  {/* Datasource filter (matches Rules tab pattern) */}
                  {renderFacetGroup(
                    'datasource',
                    'Datasource',
                    allDatasources,
                    selectedDatasources,
                    (v) => setSelectedDatasources(v),
                    facetCounts.datasource
                  )}

                  {renderFacetGroup(
                    'status',
                    'Status',
                    ['breached', 'warning', 'ok', 'no_data'],
                    selectedStatuses,
                    (v) => setSelectedStatuses(v as SloStatus[]),
                    facetCounts.status,
                    { breached: 'Breached', warning: 'Warning', ok: 'Ok', no_data: 'No data' },
                    STATUS_HEALTH_COLORS
                  )}

                  {renderFacetGroup(
                    'sliType',
                    'SLI Type',
                    allSliTypes,
                    selectedSliTypes,
                    (v) => setSelectedSliTypes(v as SliType[]),
                    facetCounts.sliType,
                    SLI_TYPE_LABELS
                  )}

                  {renderFacetGroup(
                    'service',
                    'Service',
                    allServices,
                    selectedServices,
                    (v) => setSelectedServices(v),
                    facetCounts.service
                  )}
                </div>
              </EuiPanel>
            </EuiResizablePanel>

            <EuiResizableButton />

            {/* ---- Main Panel ---- */}
            <EuiResizablePanel
              initialSize={80}
              minSize="400px"
              mode="main"
              paddingSize="none"
              style={{ paddingLeft: '4px', overflow: 'auto' }}
            >
              <EuiPanel paddingSize="s" hasBorder style={{ height: '100%', overflow: 'auto' }}>
                {/* Create SLO button (inside panel like Rules tab) */}
                <div>
                  <EuiFlexGroup
                    justifyContent="flexEnd"
                    responsive={false}
                    gutterSize="s"
                    style={{ marginBottom: 8 }}
                  >
                    <EuiFlexItem grow={false}>
                      <EuiButton
                        fill
                        iconType="plusInCircle"
                        size="s"
                        onClick={() => setShowCreateWizard(true)}
                      >
                        Create SLO
                      </EuiButton>
                    </EuiFlexItem>
                  </EuiFlexGroup>

                  {/* Status stat cards (extracted component) */}
                  <SloSummaryCards
                    totalCount={slos.length}
                    statusCounts={statusCounts}
                    statFilter={statFilter}
                    onStatFilterChange={(filter) => {
                      setStatFilter(filter);
                      setSelectedStatuses([]);
                    }}
                  />

                  <EuiSpacer size="m" />

                  {/* ================================================================ */}
                  {/* ECharts Visualizations (between stat cards and search bar)       */}
                  {/* ================================================================ */}

                  {slos.length > 0 && (
                    <>
                      {/* Row 1: Error Budget Burndown — full width */}
                      <EuiPanel hasBorder paddingSize="m">
                        <EuiFlexGroup
                          justifyContent="spaceBetween"
                          alignItems="center"
                          responsive={false}
                        >
                          <EuiFlexItem grow={false}>
                            <EuiTitle size="xs">
                              <h3>Error Budget Burndown</h3>
                            </EuiTitle>
                          </EuiFlexItem>
                          <EuiFlexItem grow={false}>
                            <EuiFlexGroup gutterSize="m" alignItems="center" responsive={false}>
                              <EuiFlexItem grow={false}>
                                <span
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 4,
                                    fontSize: 11,
                                    color: '#69707D',
                                  }}
                                >
                                  <span
                                    style={{
                                      width: 16,
                                      height: 2,
                                      background: '#BD271E',
                                      display: 'inline-block',
                                      borderTop: '1px dashed #BD271E',
                                    }}
                                  />{' '}
                                  Budget exhausted (0%)
                                </span>
                              </EuiFlexItem>
                              <EuiFlexItem grow={false}>
                                <span
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 4,
                                    fontSize: 11,
                                    color: '#69707D',
                                  }}
                                >
                                  <span
                                    style={{
                                      width: 16,
                                      height: 2,
                                      background: '#F5A700',
                                      display: 'inline-block',
                                      borderTop: '1px dashed #F5A700',
                                    }}
                                  />{' '}
                                  Warning threshold (30%)
                                </span>
                              </EuiFlexItem>
                            </EuiFlexGroup>
                          </EuiFlexItem>
                        </EuiFlexGroup>
                        <EuiSpacer size="s" />
                        <ErrorBudgetBurndown slos={slos} />
                      </EuiPanel>

                      <EuiSpacer size="m" />

                      {/* Row 2: Three charts side by side */}
                      <EuiFlexGroup gutterSize="m" responsive={true}>
                        {/* Chart 1: SLO Status Donut */}
                        <EuiFlexItem>
                          <EuiPanel hasBorder paddingSize="m">
                            <EuiTitle size="xs">
                              <h3>SLO Status</h3>
                            </EuiTitle>
                            <EuiSpacer size="s" />
                            <SloStatusDonut slos={slos} />
                          </EuiPanel>
                        </EuiFlexItem>

                        {/* Chart 2: By SLI Type */}
                        <EuiFlexItem>
                          <EuiPanel hasBorder paddingSize="m">
                            <EuiTitle size="xs">
                              <h3>By SLI Type</h3>
                            </EuiTitle>
                            <EuiSpacer size="s" />
                            <SlosBySliType slos={slos} />
                          </EuiPanel>
                        </EuiFlexItem>

                        {/* Chart 3: By Service */}
                        <EuiFlexItem>
                          <EuiPanel hasBorder paddingSize="m">
                            <EuiTitle size="xs">
                              <h3>By Service</h3>
                            </EuiTitle>
                            <EuiSpacer size="s" />
                            <SlosByService slos={slos} />
                          </EuiPanel>
                        </EuiFlexItem>
                      </EuiFlexGroup>

                      <EuiSpacer size="m" />
                    </>
                  )}

                  {/* Search bar (inside the bordered panel) */}
                  <EuiFieldSearch
                    placeholder="Search SLOs by name, service, operation..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setPageIndex(0);
                    }}
                    isClearable
                    fullWidth
                    aria-label="Search SLOs"
                  />
                </div>

                <EuiSpacer size="s" />

                {/* Count row (matches Rules tab position) */}
                <div>
                  <EuiFlexGroup gutterSize="s" alignItems="center" justifyContent="spaceBetween">
                    <EuiFlexItem grow={false}>
                      <EuiText size="s">
                        <strong>{filteredSlos.length}</strong> SLOs
                        {activeFilterCount > 0 && (
                          <span>
                            {' '}
                            &middot; {activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''}
                          </span>
                        )}
                      </EuiText>
                    </EuiFlexItem>
                    <EuiFlexItem grow={false}>
                      <EuiButtonIcon aria-label="Refresh" iconType="refresh" onClick={fetchSlos} />
                    </EuiFlexItem>
                  </EuiFlexGroup>
                </div>

                <EuiSpacer size="s" />

                {/* Table */}
                <div className="slo-table-wrapper">
                  <style>{SLO_TABLE_CSS}</style>
                  {loading ? (
                    <EuiEmptyPrompt
                      icon={<EuiLoadingSpinner size="xl" />}
                      title={<h3>Loading SLOs...</h3>}
                    />
                  ) : paginatedSlos.length === 0 ? (
                    <EuiEmptyPrompt
                      iconType="visGauge"
                      title={<h3>No SLOs found</h3>}
                      body={
                        <p>
                          {slos.length === 0
                            ? 'Create your first SLO to start tracking service reliability.'
                            : 'No SLOs match your current search and filters.'}
                        </p>
                      }
                      actions={
                        activeFilterCount > 0 || searchQuery ? (
                          <EuiButton
                            onClick={() => {
                              clearAllFilters();
                              setSearchQuery('');
                            }}
                          >
                            Clear filters
                          </EuiButton>
                        ) : (
                          <EuiButton fill onClick={() => setShowCreateWizard(true)}>
                            Create SLO
                          </EuiButton>
                        )
                      }
                    />
                  ) : (
                    <>
                      <EuiBasicTable
                        items={paginatedSlos}
                        itemId="id"
                        columns={columns}
                        itemIdToExpandedRowMap={itemIdToExpandedRowMap}
                        isExpandable
                        hasActions
                      />
                      {filteredSlos.length > 0 && (
                        <>
                          <EuiSpacer size="m" />
                          <TablePagination
                            pageIndex={pageIndex}
                            pageSize={pageSize}
                            totalItemCount={filteredSlos.length}
                            pageSizeOptions={[10, 20, 50]}
                            onChangePage={setPageIndex}
                            onChangePageSize={(size) => {
                              setPageSize(size);
                              setPageIndex(0);
                            }}
                          />
                        </>
                      )}
                    </>
                  )}
                </div>
              </EuiPanel>
            </EuiResizablePanel>
          </>
        )}
      </EuiResizableContainer>

      {/* Create SLO Wizard */}
      {showCreateWizard && (
        <CreateSloWizard
          datasourceId={slos[0]?.datasourceId || ''}
          onClose={() => setShowCreateWizard(false)}
          onCreated={fetchSlos}
          apiClient={apiClient}
        />
      )}

      {/* SLO Detail Flyout */}
      {selectedSloId && (
        <SloDetailFlyout
          slo={slos.find((s) => s.id === selectedSloId) || null}
          onClose={() => {
            setSelectedSloId(null);
            onSloClose?.();
          }}
          apiClient={apiClient}
          onDelete={(id) => {
            handleDelete(id);
            setSelectedSloId(null);
            onSloClose?.();
          }}
        />
      )}
    </>
  );
};

export default SloListing;
