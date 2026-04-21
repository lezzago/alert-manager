/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  EuiAccordion,
  EuiBadge,
  EuiBasicTable,
  EuiButtonGroup,
  EuiCheckbox,
  EuiFieldSearch,
  EuiFlexGroup,
  EuiFlexItem,
  EuiHealth,
  EuiLoadingSpinner,
  EuiPanel,
  EuiResizableContainer,
  EuiSpacer,
  EuiStat,
  EuiText,
  EuiButton,
} from '@elastic/eui';
import type { AlarmsApiClient } from '../services/alarms_client';
import type { NavigationService } from '../services/navigation_service';
import type { EnrichedOtelService } from '../../common/types';
import type { SloInput } from '../../common/slo_types';
import type { SuggestionBadgeData } from '../../common/slo_suggestion_types';
import { MOCK_SERVICE_TRENDS } from '../../common/mock_data';
import { MetricSparkline } from './metric_sparkline';
import { ServiceDetailFlyout } from './service_detail_flyout';
import { CreateSloWizard } from './create_slo_wizard';
import { ServiceHealthDashboard } from './service_health_dashboard';
import { CoverageGapPanel } from './coverage_gap_panel';
import { ServicesEmptyState } from './services_empty_state';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ServicesTabProps {
  apiClient: AlarmsApiClient;
  navigationService?: NavigationService;
  initialServiceName?: string;
  onServiceSelect?: (serviceName: string) => void;
  onServiceClose?: () => void;
}

type HealthLevel = 'critical' | 'degraded' | 'healthy' | 'unknown';
type SignalFilter = 'traces' | 'logs' | 'metrics';
type SloFilter = 'yes' | 'no';

interface ActiveFilters {
  health: Set<HealthLevel>;
  signal: Set<SignalFilter>;
  hasSlos: Set<SloFilter>;
}

const EMPTY_FILTERS: ActiveFilters = {
  health: new Set(),
  signal: new Set(),
  hasSlos: new Set(),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const errorBudgetColor = (budget?: number): string => {
  if (budget === undefined) return '#98A2B3';
  if (budget < 0.1) return '#BD271E';
  if (budget < 0.3) return '#F5A700';
  return '#017D73';
};

const alertHealthColor = (count: number): string => {
  if (count === 0) return 'success';
  if (count <= 2) return 'warning';
  return 'danger';
};

const computeHealth = (svc: EnrichedOtelService): HealthLevel => {
  if (svc.worstErrorBudget !== undefined && svc.worstErrorBudget < 0.1) return 'critical';
  if (svc.activeAlertCount > 2) return 'critical';
  if (
    svc.activeAlertCount > 0 ||
    (svc.worstErrorBudget !== undefined && svc.worstErrorBudget < 0.3)
  )
    return 'degraded';
  if (svc.sloCount === 0 && svc.activeAlertCount === 0) return 'unknown';
  return 'healthy';
};

const healthLabel: Record<HealthLevel, string> = {
  critical: 'Critical',
  degraded: 'Degraded',
  healthy: 'Healthy',
  unknown: 'Unknown',
};

const healthColor: Record<HealthLevel, string> = {
  critical: 'danger',
  degraded: 'warning',
  healthy: 'success',
  unknown: 'default',
};

// ---------------------------------------------------------------------------
// Filter Sidebar (extracted for React.memo isolation)
// ---------------------------------------------------------------------------

interface FilterSidebarProps {
  filters: ActiveFilters;
  onFiltersChange: (next: ActiveFilters) => void;
  healthCounts: Record<HealthLevel, number>;
  signalCounts: Record<SignalFilter, number>;
  sloCounts: Record<SloFilter, number>;
}

const FilterSidebar: React.FC<FilterSidebarProps> = ({
  filters,
  onFiltersChange,
  healthCounts,
  signalCounts,
  sloCounts,
}) => {
  const toggleHealth = (h: HealthLevel) => {
    const next = new Set(filters.health);
    next.has(h) ? next.delete(h) : next.add(h);
    onFiltersChange({ ...filters, health: next });
  };
  const toggleSignal = (s: SignalFilter) => {
    const next = new Set(filters.signal);
    next.has(s) ? next.delete(s) : next.add(s);
    onFiltersChange({ ...filters, signal: next });
  };
  const toggleSlo = (s: SloFilter) => {
    const next = new Set(filters.hasSlos);
    next.has(s) ? next.delete(s) : next.add(s);
    onFiltersChange({ ...filters, hasSlos: next });
  };

  return (
    <div style={{ padding: '0 8px' }} data-test-subj="services-filter-sidebar">
      <EuiText size="xs" color="subdued">
        <strong>Filters</strong>
      </EuiText>
      <EuiSpacer size="s" />

      <EuiAccordion
        id="filter-health"
        buttonContent="Health Level"
        initialIsOpen
        data-test-subj="filter-health-accordion"
      >
        <EuiSpacer size="xs" />
        {(['critical', 'degraded', 'healthy', 'unknown'] as HealthLevel[]).map((h) => (
          <EuiCheckbox
            key={h}
            id={`filter-health-${h}`}
            label={`${healthLabel[h]} (${healthCounts[h]})`}
            checked={filters.health.has(h)}
            onChange={() => toggleHealth(h)}
            data-test-subj={`filter-health-${h}`}
          />
        ))}
      </EuiAccordion>

      <EuiSpacer size="m" />

      <EuiAccordion
        id="filter-signal"
        buttonContent="Signal Type"
        initialIsOpen
        data-test-subj="filter-signal-accordion"
      >
        <EuiSpacer size="xs" />
        {(['traces', 'logs', 'metrics'] as SignalFilter[]).map((s) => (
          <EuiCheckbox
            key={s}
            id={`filter-signal-${s}`}
            label={`${s.charAt(0).toUpperCase() + s.slice(1)} (${signalCounts[s]})`}
            checked={filters.signal.has(s)}
            onChange={() => toggleSignal(s)}
            data-test-subj={`filter-signal-${s}`}
          />
        ))}
      </EuiAccordion>

      <EuiSpacer size="m" />

      <EuiAccordion
        id="filter-slos"
        buttonContent="Has SLOs"
        initialIsOpen
        data-test-subj="filter-slos-accordion"
      >
        <EuiSpacer size="xs" />
        {(['yes', 'no'] as SloFilter[]).map((s) => (
          <EuiCheckbox
            key={s}
            id={`filter-slo-${s}`}
            label={`${s === 'yes' ? 'Yes' : 'No'} (${sloCounts[s]})`}
            checked={filters.hasSlos.has(s)}
            onChange={() => toggleSlo(s)}
            data-test-subj={`filter-slo-${s}`}
          />
        ))}
      </EuiAccordion>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Active Filter Badges
// ---------------------------------------------------------------------------

interface FilterBadgesProps {
  filters: ActiveFilters;
  onRemove: (type: keyof ActiveFilters, value: string) => void;
  onClearAll: () => void;
}

const FilterBadges: React.FC<FilterBadgesProps> = ({ filters, onRemove, onClearAll }) => {
  const badges: Array<{ type: keyof ActiveFilters; value: string; label: string }> = [];
  for (const h of filters.health) badges.push({ type: 'health', value: h, label: healthLabel[h] });
  for (const s of filters.signal)
    badges.push({ type: 'signal', value: s, label: s.charAt(0).toUpperCase() + s.slice(1) });
  for (const s of filters.hasSlos)
    badges.push({ type: 'hasSlos', value: s, label: `SLOs: ${s === 'yes' ? 'Yes' : 'No'}` });

  if (badges.length === 0) return null;

  return (
    <>
      <EuiFlexGroup
        gutterSize="xs"
        alignItems="center"
        wrap
        responsive={false}
        data-test-subj="active-filter-badges"
      >
        {badges.map((b) => (
          <EuiFlexItem key={`${b.type}-${b.value}`} grow={false}>
            <EuiBadge
              color="hollow"
              iconType="cross"
              iconSide="right"
              iconOnClick={() => onRemove(b.type, b.value)}
              iconOnClickAriaLabel={`Remove ${b.label} filter`}
              data-test-subj={`filter-badge-${b.type}-${b.value}`}
            >
              {b.label}
            </EuiBadge>
          </EuiFlexItem>
        ))}
        <EuiFlexItem grow={false}>
          <span
            role="button"
            tabIndex={0}
            onClick={onClearAll}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onClearAll();
            }}
            style={{ cursor: 'pointer' }}
            data-test-subj="filter-clear-all"
          >
            <EuiBadge color="danger" iconType="cross" iconSide="right">
              Clear all
            </EuiBadge>
          </span>
        </EuiFlexItem>
      </EuiFlexGroup>
      <EuiSpacer size="s" />
    </>
  );
};

// ---------------------------------------------------------------------------
// Memoized Table Panel (prevents re-renders from resizable container mousemove)
// ---------------------------------------------------------------------------

interface TablePanelProps {
  filtered: EnrichedOtelService[];
  columns: Array<Record<string, unknown>>;
  sortField: keyof EnrichedOtelService;
  sortDirection: 'asc' | 'desc';
  onSortChange: (field: keyof EnrichedOtelService, direction: 'asc' | 'desc') => void;
}

const TablePanelUI: React.FC<TablePanelProps> = ({
  filtered,
  columns,
  sortField,
  sortDirection,
  onSortChange,
}) => (
  <EuiBasicTable<EnrichedOtelService>
    items={filtered}
    columns={columns as any}
    sorting={{ sort: { field: sortField, direction: sortDirection } }}
    onChange={({ sort }) => {
      if (sort) onSortChange(sort.field as keyof EnrichedOtelService, sort.direction);
    }}
    data-test-subj="services-table"
  />
);

const TablePanel = React.memo(TablePanelUI);

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export const ServicesTab: React.FC<ServicesTabProps> = ({
  apiClient,
  navigationService,
  initialServiceName,
  onServiceSelect,
  onServiceClose,
}) => {
  const [services, setServices] = useState<EnrichedOtelService[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedService, setSelectedService] = useState<EnrichedOtelService | null>(null);
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<keyof EnrichedOtelService>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [badges, setBadges] = useState<Record<string, SuggestionBadgeData>>({});
  const [wizardPrefill, setWizardPrefill] = useState<SloInput | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'topology'>('list');
  const [filters, setFilters] = useState<ActiveFilters>(EMPTY_FILTERS);

  const viewToggleOptions = useMemo(
    () => [
      { id: 'list', label: 'List' },
      { id: 'topology', label: 'Topology' },
    ],
    []
  );

  const fetchServices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await apiClient.listServices();
      setServices(resp.services ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch services');
    } finally {
      setLoading(false);
    }
  }, [apiClient]);

  const fetchBadges = useCallback(async () => {
    try {
      const data = await apiClient.getServiceBadges();
      setBadges(data);
    } catch {
      // Graceful degradation — badges are optional
    }
  }, [apiClient]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const resp = await apiClient.listServices();
        if (!cancelled) setServices(resp.services ?? []);
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to fetch services');
      } finally {
        if (!cancelled) setLoading(false);
      }
      try {
        const data = await apiClient.getServiceBadges();
        if (!cancelled) setBadges(data);
      } catch {
        // Graceful degradation
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [apiClient]);

  // Restore selected service from URL hash on mount
  useEffect(() => {
    if (initialServiceName && services.length > 0 && !selectedService) {
      const svc = services.find((s) => s.name === initialServiceName);
      if (svc) setSelectedService(svc);
    }
  }, [initialServiceName, services, selectedService]);

  // ---------- Filter counts (computed from unfiltered services) ----------

  const healthCounts = useMemo(() => {
    const counts: Record<HealthLevel, number> = {
      critical: 0,
      degraded: 0,
      healthy: 0,
      unknown: 0,
    };
    for (const svc of services) counts[computeHealth(svc)]++;
    return counts;
  }, [services]);

  const signalCounts = useMemo(() => {
    const counts: Record<SignalFilter, number> = { traces: 0, logs: 0, metrics: 0 };
    for (const svc of services) {
      if (svc.signals.hasTraces) counts.traces++;
      if (svc.signals.hasLogs) counts.logs++;
      if (svc.signals.hasMetrics) counts.metrics++;
    }
    return counts;
  }, [services]);

  const sloCounts = useMemo(() => {
    const counts: Record<SloFilter, number> = { yes: 0, no: 0 };
    for (const svc of services) svc.sloCount > 0 ? counts.yes++ : counts.no++;
    return counts;
  }, [services]);

  // ---------- Filtering + sorting ----------

  const hasActiveFilters =
    filters.health.size > 0 || filters.signal.size > 0 || filters.hasSlos.size > 0;

  const filtered = useMemo(() => {
    let result = services;

    // Text search
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.environment.toLowerCase().includes(q) ||
          (s.sdkLanguage ?? '').toLowerCase().includes(q)
      );
    }

    // Faceted filters
    if (filters.health.size > 0) {
      result = result.filter((s) => filters.health.has(computeHealth(s)));
    }
    if (filters.signal.size > 0) {
      result = result.filter((s) => {
        if (filters.signal.has('traces') && s.signals.hasTraces) return true;
        if (filters.signal.has('logs') && s.signals.hasLogs) return true;
        if (filters.signal.has('metrics') && s.signals.hasMetrics) return true;
        return false;
      });
    }
    if (filters.hasSlos.size > 0) {
      result = result.filter((s) => {
        const has = s.sloCount > 0 ? 'yes' : 'no';
        return filters.hasSlos.has(has);
      });
    }

    // Sort
    result = [...result].sort((a, b) => {
      const aVal = a[sortField] ?? '';
      const bVal = b[sortField] ?? '';
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    return result;
  }, [services, search, sortField, sortDirection, filters]);

  // ---------- Filter badge handlers ----------

  const handleRemoveFilter = useCallback((type: keyof ActiveFilters, value: string) => {
    setFilters((prev) => {
      const next = { ...prev };
      const s = new Set(prev[type]);
      s.delete(value as never);
      next[type] = s as any;
      return next;
    });
  }, []);

  const handleClearFilters = useCallback(() => setFilters(EMPTY_FILTERS), []);

  // ---------- Sort handler for memoized table ----------

  const handleSortChange = useCallback(
    (field: keyof EnrichedOtelService, direction: 'asc' | 'desc') => {
      setSortField(field);
      setSortDirection(direction);
    },
    []
  );

  // ---------- Stats ----------

  const totalServices = services.length;
  const withSlos = services.filter((s) => s.sloCount > 0).length;
  const withAlerts = services.filter((s) => s.activeAlertCount > 0).length;

  // ---------- Table columns ----------

  const columns = useMemo(
    () => [
      {
        field: 'name',
        name: 'Service',
        sortable: true,
        truncateText: true,
        render: (name: string, svc: EnrichedOtelService) => (
          <span
            role="button"
            tabIndex={0}
            style={{ cursor: 'pointer', fontWeight: 600 }}
            onClick={() => {
              setSelectedService(svc);
              onServiceSelect?.(svc.name);
            }}
            onKeyDown={(e: React.KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setSelectedService(svc);
                onServiceSelect?.(svc.name);
              }
            }}
            data-test-subj={`service-name-${name}`}
          >
            {name}
          </span>
        ),
      },
      {
        field: 'environment',
        name: 'Environment',
        sortable: true,
        width: '120px',
        render: (env: string) => <EuiBadge color="hollow">{env}</EuiBadge>,
      },
      {
        field: 'sdkLanguage',
        name: 'SDK',
        sortable: true,
        width: '80px',
        render: (lang: string | undefined) => (
          <EuiText size="s" color={lang ? 'default' : 'subdued'}>
            {lang ?? '--'}
          </EuiText>
        ),
      },
      {
        field: 'activeAlertCount',
        name: 'Alerts',
        sortable: true,
        width: '70px',
        render: (count: number) => (
          <EuiHealth color={alertHealthColor(count)} data-test-subj="service-alert-count">
            {count}
          </EuiHealth>
        ),
      },
      {
        field: 'name',
        name: 'Alert Trend',
        width: '100px',
        render: (name: string) => {
          const trend = MOCK_SERVICE_TRENDS[name];
          return (
            <MetricSparkline
              data={trend?.alertTrend ?? []}
              color="#BD271E"
              height={20}
              width={80}
            />
          );
        },
      },
      {
        field: 'sloCount',
        name: 'SLOs',
        sortable: true,
        width: '60px',
        align: 'center' as const,
        render: (count: number) => (
          <EuiBadge color={count > 0 ? 'primary' : 'hollow'}>{count}</EuiBadge>
        ),
      },
      {
        field: 'worstErrorBudget',
        name: 'Error Budget',
        sortable: true,
        width: '120px',
        render: (budget: number | undefined) => {
          if (budget === undefined) {
            return (
              <EuiText size="s" color="subdued">
                --
              </EuiText>
            );
          }
          const color = errorBudgetColor(budget);
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 50, height: 6, background: '#EDF0F5', borderRadius: 3 }}>
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
                {(budget * 100).toFixed(1)}%
              </span>
            </div>
          );
        },
      },
      {
        field: 'name',
        name: 'Budget Trend',
        width: '100px',
        render: (name: string) => {
          const trend = MOCK_SERVICE_TRENDS[name];
          return (
            <MetricSparkline
              data={trend?.errorBudgetTrend ?? []}
              color="#017D73"
              height={20}
              width={80}
            />
          );
        },
      },
      {
        field: 'name',
        name: 'SLO Coverage',
        width: '150px',
        render: (name: string) => {
          const badge = badges[name];
          if (!badge || badge.totalSuggested === 0) {
            return (
              <EuiText size="s" color="subdued">
                --
              </EuiText>
            );
          }
          const allCreated = badge.alreadyCreated >= badge.totalSuggested;
          return (
            <EuiBadge
              color={allCreated ? 'success' : 'warning'}
              data-test-subj={`service-slo-coverage-${name}`}
            >
              {badge.alreadyCreated} of {badge.totalSuggested} suggested
            </EuiBadge>
          );
        },
      },
      {
        field: 'signals',
        name: 'Signals',
        width: '110px',
        render: (signals: EnrichedOtelService['signals']) => (
          <EuiFlexGroup gutterSize="xs" responsive={false}>
            {signals.hasTraces && (
              <EuiFlexItem grow={false}>
                <EuiBadge color="primary">T</EuiBadge>
              </EuiFlexItem>
            )}
            {signals.hasLogs && (
              <EuiFlexItem grow={false}>
                <EuiBadge color="accent">L</EuiBadge>
              </EuiFlexItem>
            )}
            {signals.hasMetrics && (
              <EuiFlexItem grow={false}>
                <EuiBadge color="success">M</EuiBadge>
              </EuiFlexItem>
            )}
          </EuiFlexGroup>
        ),
      },
    ],
    [badges, onServiceSelect]
  );

  // ---------- Render ----------

  if (loading) {
    return (
      <EuiFlexGroup justifyContent="center" alignItems="center" style={{ minHeight: 300 }}>
        <EuiFlexItem grow={false}>
          <EuiLoadingSpinner size="xl" />
        </EuiFlexItem>
      </EuiFlexGroup>
    );
  }

  if (error) {
    return (
      <EuiPanel color="danger" paddingSize="l">
        <EuiText color="danger">{error}</EuiText>
        <EuiSpacer size="s" />
        <EuiButton
          size="s"
          color="danger"
          onClick={() => {
            setError('');
            fetchServices();
            fetchBadges();
          }}
        >
          Retry
        </EuiButton>
      </EuiPanel>
    );
  }

  if (services.length === 0) {
    return <ServicesEmptyState />;
  }

  return (
    <>
      {/* Stat cards */}
      <EuiFlexGroup gutterSize="m" data-test-subj="services-stat-cards">
        <EuiFlexItem>
          <EuiPanel paddingSize="m" hasBorder>
            <EuiStat title={totalServices} description="Total Services" titleSize="m" />
          </EuiPanel>
        </EuiFlexItem>
        <EuiFlexItem>
          <EuiPanel paddingSize="m" hasBorder>
            <EuiStat title={withSlos} description="With SLOs" titleSize="m" titleColor="primary" />
          </EuiPanel>
        </EuiFlexItem>
        <EuiFlexItem>
          <EuiPanel paddingSize="m" hasBorder>
            <EuiStat
              title={totalServices - withSlos}
              description="Without SLOs"
              titleSize="m"
              titleColor={totalServices - withSlos > 0 ? 'accent' : 'default'}
            />
          </EuiPanel>
        </EuiFlexItem>
        <EuiFlexItem>
          <EuiPanel paddingSize="m" hasBorder>
            <EuiStat
              title={withAlerts}
              description="With Active Alerts"
              titleSize="m"
              titleColor={withAlerts > 0 ? 'danger' : 'default'}
            />
          </EuiPanel>
        </EuiFlexItem>
      </EuiFlexGroup>

      <EuiSpacer size="m" />

      {/* View toggle + search */}
      <EuiFlexGroup alignItems="center" gutterSize="m">
        <EuiFlexItem grow={false}>
          <EuiButtonGroup
            legend="Services view mode"
            options={viewToggleOptions}
            idSelected={viewMode}
            onChange={(id) => setViewMode(id as 'list' | 'topology')}
            buttonSize="compressed"
            data-test-subj="services-view-toggle"
          />
        </EuiFlexItem>
        {viewMode === 'list' && (
          <EuiFlexItem>
            <EuiFieldSearch
              placeholder="Search services..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              isClearable
              fullWidth
              data-test-subj="services-search"
            />
          </EuiFlexItem>
        )}
      </EuiFlexGroup>

      <EuiSpacer size="m" />

      {/* Coverage Gap Analysis */}
      {services.length > 0 && (
        <>
          <CoverageGapPanel
            apiClient={apiClient}
            onServiceSelect={(serviceName) => {
              const svc = services.find((s) => s.name === serviceName);
              if (svc) {
                setSelectedService(svc);
                onServiceSelect?.(serviceName);
              }
            }}
          />
          <EuiSpacer size="m" />
        </>
      )}

      {/* Active filter badges */}
      {hasActiveFilters && (
        <FilterBadges
          filters={filters}
          onRemove={handleRemoveFilter}
          onClearAll={handleClearFilters}
        />
      )}

      {/* View content */}
      {viewMode === 'topology' ? (
        <ServiceHealthDashboard
          services={services}
          navigationService={navigationService}
          onServiceSelect={(serviceName) => {
            const svc = services.find((s) => s.name === serviceName);
            if (svc) {
              setSelectedService(svc);
              onServiceSelect?.(serviceName);
            }
          }}
        />
      ) : (
        <EuiResizableContainer style={{ minHeight: 400 }} data-test-subj="services-resizable">
          {(EuiResizablePanel, EuiResizableButton) => (
            <>
              <EuiResizablePanel
                initialSize={18}
                minSize="150px"
                id="services-filter-sidebar"
                paddingSize="none"
                style={{ overflow: 'auto' }}
              >
                <FilterSidebar
                  filters={filters}
                  onFiltersChange={setFilters}
                  healthCounts={healthCounts}
                  signalCounts={signalCounts}
                  sloCounts={sloCounts}
                />
              </EuiResizablePanel>

              <EuiResizableButton />

              <EuiResizablePanel
                initialSize={82}
                minSize="400px"
                id="services-table-panel"
                paddingSize="none"
              >
                <TablePanel
                  filtered={filtered}
                  columns={columns as any}
                  sortField={sortField}
                  sortDirection={sortDirection}
                  onSortChange={handleSortChange}
                />
              </EuiResizablePanel>
            </>
          )}
        </EuiResizableContainer>
      )}

      {/* Detail Flyout */}
      {selectedService && (
        <ServiceDetailFlyout
          service={selectedService}
          onClose={() => {
            setSelectedService(null);
            onServiceClose?.();
          }}
          apiClient={apiClient}
          navigationService={navigationService}
          onCreateSlo={(prefill) => {
            setSelectedService(null);
            onServiceClose?.();
            setWizardPrefill(prefill);
          }}
        />
      )}

      {/* SLO Creation Wizard (from suggestion) */}
      {wizardPrefill && (
        <CreateSloWizard
          datasourceId={wizardPrefill.datasourceId}
          onClose={() => setWizardPrefill(null)}
          onCreated={() => {
            setWizardPrefill(null);
            fetchServices();
            fetchBadges();
          }}
          apiClient={apiClient}
          prefill={wizardPrefill}
        />
      )}
    </>
  );
};
