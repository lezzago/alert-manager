/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * CelestialMap-based service topology graph (replaces ECharts Phase 5 graph).
 *
 * Uses @osd/apm-topology's CelestialMap (ReactFlow + Dagre) for:
 *  - Health-colored service card nodes with SLO/alert badges
 *  - Hierarchical Dagre layout (top-to-bottom)
 *  - Animated edges for blast radius paths
 *  - Minimap overlay
 *  - Accessible keyboard navigation (ReactFlow)
 *  - Node click → service detail flyout
 */

import React, { useMemo, useCallback } from 'react';
import { CelestialMap } from '@osd/apm-topology';
import type {
  CelestialMapModel,
  CelestialNode,
  CelestialEdge,
  CelestialCardProps,
} from '@osd/apm-topology';
import type { TopologyGraph, ServiceHealthLevel } from '../../common/topology_types';

interface TopologyCelestialGraphProps {
  graph: TopologyGraph;
  /** Currently selected node (highlighted). */
  selectedNodeId?: string;
  /** Called when a node is clicked. */
  onNodeClick?: (serviceId: string) => void;
  /** Height of the graph container. */
  height?: number | string;
}

/** Map Alert Manager health levels to CelestialMap node border/glow colors. */
const HEALTH_TO_COLOR: Record<ServiceHealthLevel, string> = {
  healthy: 'var(--osd-color-status-ok, #017D73)',
  degraded: 'var(--osd-color-status-warning, #F5A700)',
  critical: 'var(--osd-color-status-error, #BD271E)',
  unknown: 'var(--osd-color-status-unknown, #98A2B3)',
};

/** Map Alert Manager health levels to TypeBadge props. */
const HEALTH_TO_BADGE: Record<ServiceHealthLevel, { label: string; color: string }> = {
  critical: { label: 'Critical', color: '#BD271E' },
  degraded: { label: 'Degraded', color: '#F5A700' },
  healthy: { label: 'Healthy', color: '#017D73' },
  unknown: { label: 'Unknown', color: '#98A2B3' },
};

/** Build the action button label showing the most relevant metric. */
function actionLabel(alertCount: number, errorBudget?: number): string {
  if (alertCount > 0) {
    return `${alertCount} alert${alertCount !== 1 ? 's' : ''}`;
  }
  if (errorBudget !== undefined) {
    return `${(errorBudget * 100).toFixed(0)}% EB`;
  }
  return 'View';
}

/**
 * Transform our TopologyGraph model into CelestialMap's node/edge format.
 *
 * Node type: `serviceCard` — shows title, subtitle, type badge (health),
 * SLI breach status, and an action button with alert count or error budget.
 *
 * Blast radius: impacted nodes stay at full opacity; non-impacted nodes
 * get `isFaded: true` when any blast radius is active.
 */
function transformGraph(graph: TopologyGraph): CelestialMapModel {
  const hasBlastRadius = graph.nodes.some((n) => n.impacted);

  const nodes: CelestialNode[] = graph.nodes.map((node) => {
    const svc = node.service;
    const badge = HEALTH_TO_BADGE[node.health];

    // Map SLO state to CelestialMap's SloHealth format
    const breachedCount = svc.worstErrorBudget !== undefined && svc.worstErrorBudget < 0.1 ? 1 : 0;

    const data: CelestialCardProps & { showDonut?: boolean } = {
      id: node.id,
      title: svc.name,
      subtitle: svc.environment,
      keyAttributes: { Name: svc.name, Environment: svc.environment },
      color: HEALTH_TO_COLOR[node.health],
      isFaded: hasBlastRadius && !node.impacted,
      typeBadge: { label: badge.label, color: badge.color },
      health:
        svc.sloCount > 0
          ? {
              status: breachedCount > 0 ? 'breached' : 'ok',
              breached: breachedCount,
              recovered: svc.sloCount - breachedCount,
              total: svc.sloCount,
            }
          : undefined,
      metrics: {
        requests: Math.max(svc.sloCount, 1),
        faults5xx: svc.activeAlertCount,
        errors4xx: 0,
      },
      // Hide the health donut — our data model doesn't have request/fault proportions
      showDonut: false,
      actionButton: {
        label: actionLabel(svc.activeAlertCount, svc.worstErrorBudget),
      },
    };

    return {
      id: node.id,
      type: 'serviceCard',
      position: { x: 0, y: 0 }, // Dagre layout calculates actual positions
      data,
    };
  });

  const edges: CelestialEdge[] = graph.edges.map((edge) => ({
    id: `${edge.source}->${edge.target}`,
    source: edge.source,
    target: edge.target,
    type: 'celestialEdge',
    data: {
      style: {
        type: edge.impacted ? ('solid' as const) : ('dashed' as const),
        animationType: edge.impacted ? ('pulse' as const) : ('none' as const),
        color: edge.impacted ? 'var(--osd-color-status-error, #BD271E)' : undefined,
        strokeWidth: edge.impacted ? 3 : 1.5,
        marker: 'arrowClosed' as const,
      },
    },
  }));

  return { nodes, edges };
}

export const TopologyCelestialGraph: React.FC<TopologyCelestialGraphProps> = ({
  graph,
  selectedNodeId,
  onNodeClick,
  height = 500,
}) => {
  const celestialModel = useMemo(() => transformGraph(graph), [graph]);

  // CelestialMap expects map keyed by group ID — we use a single "default" group
  const map = useMemo(() => ({ default: celestialModel }), [celestialModel]);

  const handleDashboardClick = useCallback(
    (node?: CelestialCardProps) => {
      if (node?.id) onNodeClick?.(node.id);
    },
    [onNodeClick]
  );

  return (
    <div style={{ height, width: '100%' }} data-test-subj="topology-graph">
      <CelestialMap
        map={map}
        selectedNodeId={selectedNodeId}
        onDashboardClick={handleDashboardClick}
        showMinimap
        nodesDraggable
        legend={false}
        layoutOptions={{
          direction: 'TB',
          rankSeparation: 150,
          nodeSeparation: 80,
        }}
      />
    </div>
  );
};
