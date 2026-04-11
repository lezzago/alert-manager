/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  EuiBasicTable,
  EuiFlexGroup,
  EuiFlexItem,
  EuiSpacer,
  EuiText,
  EuiBadge,
  EuiPanel,
  EuiStat,
  EuiEmptyPrompt,
  EuiLoadingSpinner,
  EuiFieldSearch,
  EuiHealth,
} from '@elastic/eui';
import type { AlarmsApiClient } from '../services/alarms_client';
import type { NavigationService } from '../services/navigation_service';
import type { EnrichedOtelService } from '../../common/types';
import type { SloInput } from '../../common/slo_types';
import type { SuggestionBadgeData } from '../../common/slo_suggestion_types';
import { ServiceDetailFlyout } from './service_detail_flyout';
import { CreateSloWizard } from './create_slo_wizard';

interface ServicesTabProps {
  apiClient: AlarmsApiClient;
  navigationService?: NavigationService;
  /** Service name from URL hash to auto-open detail flyout. */
  initialServiceName?: string;
  /** Callback when a service is selected (updates URL hash). */
  onServiceSelect?: (serviceName: string) => void;
  /** Callback when service detail is closed (clears URL hash). */
  onServiceClose?: () => void;
}

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
    fetchServices();
    fetchBadges();
  }, [fetchServices, fetchBadges]);

  // Restore selected service from URL hash on mount
  useEffect(() => {
    if (initialServiceName && services.length > 0 && !selectedService) {
      const svc = services.find((s) => s.name === initialServiceName);
      if (svc) setSelectedService(svc);
    }
  }, [initialServiceName, services, selectedService]);

  const filtered = useMemo(() => {
    let result = services;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.environment.toLowerCase().includes(q) ||
          (s.sdkLanguage ?? '').toLowerCase().includes(q)
      );
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
  }, [services, search, sortField, sortDirection]);

  // Stats
  const totalServices = services.length;
  const withSlos = services.filter((s) => s.sloCount > 0).length;
  const withAlerts = services.filter((s) => s.activeAlertCount > 0).length;

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
        width: '130px',
        render: (env: string) => <EuiBadge color="hollow">{env}</EuiBadge>,
      },
      {
        field: 'sdkLanguage',
        name: 'SDK',
        sortable: true,
        width: '90px',
        render: (lang: string | undefined) => (
          <EuiText size="s" color={lang ? 'default' : 'subdued'}>
            {lang ?? '--'}
          </EuiText>
        ),
      },
      {
        field: 'sloCount',
        name: 'SLOs',
        sortable: true,
        width: '70px',
        align: 'center' as const,
        render: (count: number) => (
          <EuiBadge color={count > 0 ? 'primary' : 'hollow'}>{count}</EuiBadge>
        ),
      },
      {
        field: 'name',
        name: 'SLO Coverage',
        width: '170px',
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
        field: 'activeAlertCount',
        name: 'Alerts',
        sortable: true,
        width: '90px',
        render: (count: number) => (
          <EuiHealth color={alertHealthColor(count)} data-test-subj="service-alert-count">
            {count}
          </EuiHealth>
        ),
      },
      {
        field: 'worstErrorBudget',
        name: 'Error Budget',
        sortable: true,
        width: '130px',
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
        field: 'signals',
        name: 'Signals',
        width: '130px',
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
      {
        field: 'dependencies',
        name: 'Dependencies',
        width: '80px',
        align: 'center' as const,
        render: (deps: string[]) => <EuiText size="s">{deps.length}</EuiText>,
      },
    ],
    [badges]
  );

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
      </EuiPanel>
    );
  }

  if (services.length === 0) {
    return (
      <EuiEmptyPrompt
        iconType="compute"
        title={<h2>No OTEL services discovered</h2>}
        body={
          <p>
            No OpenTelemetry-instrumented services were found. Configure APM in the Observability
            plugin and ensure Data Prepper is populating the service map index.
          </p>
        }
        data-test-subj="services-empty-state"
      />
    );
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

      {/* Search */}
      <EuiFieldSearch
        placeholder="Search services..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        isClearable
        fullWidth
        data-test-subj="services-search"
      />

      <EuiSpacer size="m" />

      {/* Table */}
      <EuiBasicTable<EnrichedOtelService>
        items={filtered}
        columns={columns}
        sorting={{
          sort: { field: sortField, direction: sortDirection },
        }}
        onChange={({ sort }) => {
          if (sort) {
            setSortField(sort.field as keyof EnrichedOtelService);
            setSortDirection(sort.direction);
          }
        }}
        data-test-subj="services-table"
      />

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
