/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Service Health Dashboard — three-panel topology view (Phase 5).
 *
 * Layout:
 *  - Left panel: compact service list with health indicators
 *  - Center panel: CelestialMap topology graph with SLO/alert overlays
 *  - Bottom panel: active incidents with dependency impact chains
 */

import React, { Component, useState, useMemo, useCallback } from 'react';
import {
  EuiFlexGroup,
  EuiFlexItem,
  EuiPanel,
  EuiText,
  EuiSpacer,
  EuiBadge,
  EuiHealth,
  EuiTitle,
  EuiEmptyPrompt,
  EuiButton,
  EuiButtonEmpty,
  EuiFieldSearch,
} from '@elastic/eui';
import type { EnrichedOtelService } from '../../common/types';
import type { NavigationService } from '../services/navigation_service';
import type { TopologyGraph, ActiveIncident } from '../../common/topology_types';
import { HEALTH_COLORS } from '../../common/topology_types';
import {
  buildTopologyGraph,
  computeBlastRadius,
  computeFullBlastRadius,
  extractActiveIncidents,
} from '../../common/topology_service';
import { groupIncidents } from '../../common/incident_grouping_service';
import type { IncidentGroup } from '../../common/root_cause_types';
import { TopologyCelestialGraph } from './topology_celestial_graph';

// Error boundary to catch topology graph rendering crashes without killing the entire dashboard
class GraphErrorBoundary extends Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  { hasError: boolean; error?: Error }
> {
  constructor(props: { children: React.ReactNode; fallback?: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <EuiEmptyPrompt
            iconType="alert"
            title={<h3>Topology graph error</h3>}
            body={<p>The graph encountered an error.</p>}
            actions={
              <EuiButton
                size="s"
                onClick={() => this.setState({ hasError: false, error: undefined })}
              >
                Try again
              </EuiButton>
            }
          />
        )
      );
    }
    return this.props.children;
  }
}

interface ServiceHealthDashboardProps {
  services: EnrichedOtelService[];
  navigationService?: NavigationService;
  /** Called when a service is selected (opens detail flyout). */
  onServiceSelect?: (serviceName: string) => void;
}

const healthColor = (level: string): string =>
  HEALTH_COLORS[level as keyof typeof HEALTH_COLORS] ?? HEALTH_COLORS.unknown;

const healthLabel = (level: string): 'success' | 'warning' | 'danger' | 'subdued' => {
  if (level === 'healthy') return 'success';
  if (level === 'degraded') return 'warning';
  if (level === 'critical') return 'danger';
  return 'subdued';
};

export const ServiceHealthDashboard: React.FC<ServiceHealthDashboardProps> = ({
  services,
  navigationService,
  onServiceSelect,
}) => {
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>();
  const [focusedIncident, setFocusedIncident] = useState<string | undefined>();
  const [serviceSearch, setServiceSearch] = useState('');

  // Build the base topology graph
  const baseGraph = useMemo(() => buildTopologyGraph(services), [services]);

  // Apply blast radius: either for a focused incident or all critical services
  const graph: TopologyGraph = useMemo(() => {
    if (focusedIncident) {
      return computeBlastRadius(baseGraph, focusedIncident);
    }
    return computeFullBlastRadius(baseGraph);
  }, [baseGraph, focusedIncident]);

  // Extract active incidents
  const incidents: ActiveIncident[] = useMemo(() => extractActiveIncidents(baseGraph), [baseGraph]);

  // Group incidents by dependency chain (Phase 6.4)
  const incidentGroups: IncidentGroup[] = useMemo(
    () => groupIncidents(incidents, baseGraph),
    [incidents, baseGraph]
  );

  // Handle node click
  const handleNodeClick = useCallback(
    (serviceId: string) => {
      setSelectedNodeId((prev) => (prev === serviceId ? undefined : serviceId));
      onServiceSelect?.(serviceId);
    },
    [onServiceSelect]
  );

  // Handle incident click
  const handleIncidentClick = useCallback((serviceName: string) => {
    setFocusedIncident((prev) => (prev === serviceName ? undefined : serviceName));
    setSelectedNodeId(serviceName);
  }, []);

  // Filtered service list for left panel
  const filteredNodes = useMemo(() => {
    let nodes = graph.nodes;
    if (serviceSearch) {
      const q = serviceSearch.toLowerCase();
      nodes = nodes.filter((n) => n.id.toLowerCase().includes(q));
    }
    // Sort: critical first, then degraded, then by name
    return [...nodes].sort((a, b) => {
      const order = { critical: 0, degraded: 1, healthy: 2, unknown: 3 };
      const diff = (order[a.health] ?? 3) - (order[b.health] ?? 3);
      if (diff !== 0) return diff;
      return a.id.localeCompare(b.id);
    });
  }, [graph.nodes, serviceSearch]);

  if (services.length === 0) {
    return (
      <EuiEmptyPrompt
        iconType="graphApp"
        title={<h2>No services to display</h2>}
        body={<p>Service topology requires discovered OTEL services.</p>}
        data-test-subj="topology-empty-state"
      />
    );
  }

  return (
    <div data-test-subj="service-health-dashboard">
      {/* Top section: service list (left) + topology graph (center) */}
      <EuiFlexGroup gutterSize="m" style={{ minHeight: 500 }}>
        {/* Left panel: Service List */}
        <EuiFlexItem grow={false} style={{ width: 260, minWidth: 260 }}>
          <EuiPanel paddingSize="s" hasBorder style={{ height: '100%', overflow: 'auto' }}>
            <EuiText size="xs" color="subdued">
              <strong>Services ({services.length})</strong>
            </EuiText>
            <EuiSpacer size="xs" />
            <EuiFieldSearch
              placeholder="Filter..."
              value={serviceSearch}
              onChange={(e) => setServiceSearch(e.target.value)}
              isClearable
              compressed
              fullWidth
              data-test-subj="topology-service-search"
            />
            <EuiSpacer size="xs" />
            {filteredNodes.map((node) => (
              <div
                key={node.id}
                role="button"
                tabIndex={0}
                onClick={() => handleNodeClick(node.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleNodeClick(node.id);
                  }
                }}
                style={{
                  padding: '6px 8px',
                  borderRadius: 4,
                  cursor: 'pointer',
                  background: selectedNodeId === node.id ? '#006BB410' : 'transparent',
                  borderLeft: `3px solid ${healthColor(node.health)}`,
                  marginBottom: 2,
                }}
                data-test-subj={`topology-service-item-${node.id}`}
              >
                <EuiFlexGroup gutterSize="xs" alignItems="center" responsive={false}>
                  <EuiFlexItem>
                    <EuiText
                      size="xs"
                      style={{ fontWeight: selectedNodeId === node.id ? 600 : 400 }}
                    >
                      {node.id}
                    </EuiText>
                  </EuiFlexItem>
                  {node.service.activeAlertCount > 0 && (
                    <EuiFlexItem grow={false}>
                      <EuiBadge color="danger">{node.service.activeAlertCount}</EuiBadge>
                    </EuiFlexItem>
                  )}
                  {node.service.sloCount > 0 && (
                    <EuiFlexItem grow={false}>
                      <EuiText size="xs" color="subdued">
                        {node.service.worstErrorBudget !== undefined
                          ? `${(node.service.worstErrorBudget * 100).toFixed(0)}%`
                          : ''}
                      </EuiText>
                    </EuiFlexItem>
                  )}
                </EuiFlexGroup>
              </div>
            ))}
          </EuiPanel>
        </EuiFlexItem>

        {/* Center panel: Topology Graph */}
        <EuiFlexItem>
          <EuiPanel paddingSize="s" hasBorder style={{ height: '100%' }}>
            <EuiFlexGroup alignItems="center" gutterSize="s" responsive={false}>
              <EuiFlexItem>
                <EuiText size="xs" color="subdued">
                  <strong>Service Topology</strong>
                </EuiText>
              </EuiFlexItem>
              {focusedIncident && (
                <EuiFlexItem grow={false}>
                  <EuiButtonEmpty
                    size="xs"
                    onClick={() => setFocusedIncident(undefined)}
                    data-test-subj="topology-clear-focus"
                  >
                    Clear focus
                  </EuiButtonEmpty>
                </EuiFlexItem>
              )}
              <EuiFlexItem grow={false}>
                <EuiFlexGroup gutterSize="xs" responsive={false}>
                  <EuiFlexItem grow={false}>
                    <EuiHealth color="success">Healthy</EuiHealth>
                  </EuiFlexItem>
                  <EuiFlexItem grow={false}>
                    <EuiHealth color="warning">Degraded</EuiHealth>
                  </EuiFlexItem>
                  <EuiFlexItem grow={false}>
                    <EuiHealth color="danger">Critical</EuiHealth>
                  </EuiFlexItem>
                </EuiFlexGroup>
              </EuiFlexItem>
            </EuiFlexGroup>
            <GraphErrorBoundary>
              <TopologyCelestialGraph
                graph={graph}
                selectedNodeId={selectedNodeId}
                onNodeClick={handleNodeClick}
                height={460}
              />
            </GraphErrorBoundary>
          </EuiPanel>
        </EuiFlexItem>
      </EuiFlexGroup>

      <EuiSpacer size="m" />

      {/* Bottom panel: Active Incidents (grouped by dependency chain) */}
      <EuiPanel paddingSize="m" hasBorder data-test-subj="topology-incidents-panel">
        <EuiTitle size="xs">
          <h3>
            Active Incidents{' '}
            {incidentGroups.length > 0 && (
              <EuiBadge color="danger">
                {incidentGroups.length} group{incidentGroups.length !== 1 ? 's' : ''}
              </EuiBadge>
            )}
          </h3>
        </EuiTitle>
        <EuiSpacer size="s" />

        {incidentGroups.length === 0 ? (
          <EuiText size="s" color="subdued" data-test-subj="topology-no-incidents">
            No active incidents. All services are healthy.
          </EuiText>
        ) : (
          <EuiFlexGroup gutterSize="s" wrap data-test-subj="topology-incident-list">
            {incidentGroups.map((group) => (
              <EuiFlexItem key={group.id} grow={false} style={{ minWidth: 280, maxWidth: 420 }}>
                <EuiPanel
                  paddingSize="s"
                  hasBorder
                  color={focusedIncident === group.rootService ? 'danger' : 'plain'}
                  onClick={() => handleIncidentClick(group.rootService)}
                  style={{ cursor: 'pointer' }}
                  data-test-subj={`topology-incident-group-${group.rootService}`}
                >
                  <EuiFlexGroup alignItems="center" gutterSize="s" responsive={false}>
                    <EuiFlexItem grow={false}>
                      <EuiHealth color={healthLabel(group.rootHealth)}>
                        <strong>{group.rootService}</strong>
                      </EuiHealth>
                    </EuiFlexItem>
                    <EuiFlexItem grow={false}>
                      <EuiBadge color="danger">
                        {group.totalAlertCount} alert{group.totalAlertCount !== 1 ? 's' : ''}
                      </EuiBadge>
                    </EuiFlexItem>
                    <EuiFlexItem grow={false}>
                      <EuiBadge
                        color={
                          group.rootCauseConfidence === 'high'
                            ? 'success'
                            : group.rootCauseConfidence === 'medium'
                              ? 'warning'
                              : 'hollow'
                        }
                        data-test-subj={`incident-group-confidence-${group.rootService}`}
                      >
                        {group.rootCauseConfidence}
                      </EuiBadge>
                    </EuiFlexItem>
                  </EuiFlexGroup>

                  {/* Show grouped services if more than one */}
                  {group.incidents.length > 1 && (
                    <>
                      <EuiSpacer size="xs" />
                      <EuiText size="xs" color="subdued">
                        Related services:{' '}
                        {group.incidents
                          .filter((inc) => inc.serviceName !== group.rootService)
                          .map((inc) => (
                            <EuiBadge
                              key={inc.serviceName}
                              color="hollow"
                              style={{ marginRight: 2, marginBottom: 2 }}
                            >
                              {inc.serviceName} ({inc.alertCount})
                            </EuiBadge>
                          ))}
                      </EuiText>
                    </>
                  )}

                  {/* Blast radius */}
                  {group.affectedServices.length > group.incidents.length && (
                    <>
                      <EuiSpacer size="xs" />
                      <EuiText size="xs" color="subdued">
                        Blast radius:{' '}
                        {group.affectedServices
                          .filter((s) => !group.incidents.some((i) => i.serviceName === s))
                          .map((name) => (
                            <EuiBadge
                              key={name}
                              color="hollow"
                              style={{ marginRight: 2, marginBottom: 2 }}
                            >
                              {name}
                            </EuiBadge>
                          ))}
                      </EuiText>
                    </>
                  )}
                </EuiPanel>
              </EuiFlexItem>
            ))}
          </EuiFlexGroup>
        )}
      </EuiPanel>
    </div>
  );
};
