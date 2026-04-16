/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ECharts-based service topology graph visualization (Phase 5).
 *
 * Renders services as nodes in a force-directed graph with:
 *  - Health-colored node borders (green/yellow/red/gray)
 *  - SLO attainment percentage on each node
 *  - Alert count badges on nodes with active alerts
 *  - Blast radius highlighting (pulsing border on impacted nodes)
 *  - Click handler for node selection
 */

import React, { useMemo, useCallback, useRef, useEffect } from 'react';
import * as echarts from 'echarts';
import type { TopologyGraph, TopologyNode } from '../../common/topology_types';
import { HEALTH_COLORS } from '../../common/topology_types';

interface TopologyGraphProps {
  graph: TopologyGraph;
  /** Currently selected node (highlighted). */
  selectedNodeId?: string;
  /** Called when a node is clicked. */
  onNodeClick?: (serviceId: string) => void;
  /** Height of the graph container. */
  height?: number | string;
}

/** Abbreviate service names for graph labels. */
function abbreviate(name: string, maxLen = 16): string {
  if (name.length <= maxLen) return name;
  return name.substring(0, maxLen - 1) + '\u2026';
}

/** Build the label for a node: service name + health summary. */
function buildNodeLabel(node: TopologyNode): string {
  const parts = [abbreviate(node.id)];
  if (node.service.worstErrorBudget !== undefined) {
    parts.push(`${(node.service.worstErrorBudget * 100).toFixed(0)}% EB`);
  }
  return parts.join('\n');
}

/** Node symbol size based on alert count and SLO count. */
function nodeSize(node: TopologyNode): number {
  const base = 40;
  const alertBoost = Math.min(node.service.activeAlertCount * 5, 20);
  const sloBoost = Math.min(node.service.sloCount * 3, 15);
  return base + alertBoost + sloBoost;
}

export const TopologyGraphView: React.FC<TopologyGraphProps> = ({
  graph,
  selectedNodeId,
  onNodeClick,
  height = 500,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<echarts.ECharts | null>(null);

  const spec = useMemo((): echarts.EChartsOption => {
    const nodes = graph.nodes.map((node) => {
      const isSelected = node.id === selectedNodeId;
      const healthColor = HEALTH_COLORS[node.health];
      const dimmed = graph.nodes.some((n) => n.impacted) && !node.impacted;

      return {
        id: node.id,
        name: node.id,
        value: node.service.activeAlertCount,
        symbolSize: nodeSize(node),
        label: {
          show: true,
          formatter: buildNodeLabel(node),
          fontSize: 11,
          lineHeight: 14,
          color: dimmed ? '#C4C8CE' : '#343741',
        },
        itemStyle: {
          color: dimmed ? '#F5F7FA' : healthColor + '20', // transparent fill
          borderColor: isSelected ? '#006BB4' : healthColor,
          borderWidth: isSelected ? 3 : 2,
          opacity: dimmed ? 0.4 : 1,
          shadowBlur: isSelected ? 10 : node.impacted ? 6 : 0,
          shadowColor: isSelected ? '#006BB440' : healthColor + '60',
        },
      };
    });

    const edges = graph.edges.map((edge) => {
      const dimmed = graph.nodes.some((n) => n.impacted) && !edge.impacted;
      return {
        source: edge.source,
        target: edge.target,
        lineStyle: {
          color: edge.impacted ? HEALTH_COLORS.critical : '#D3DAE6',
          width: edge.impacted ? 2.5 : 1.5,
          opacity: dimmed ? 0.15 : edge.impacted ? 0.9 : 0.5,
          curveness: 0.2,
          type: edge.impacted ? ('solid' as const) : ('dashed' as const),
        },
        symbol: ['none', 'arrow'],
        symbolSize: [0, 8],
      };
    });

    return {
      tooltip: {
        trigger: 'item',
        formatter: (params: unknown) => {
          const p = params as { dataType?: string; data?: { id?: string }; name?: string };
          if (p.dataType !== 'node') return '';
          const nodeData = graph.nodes.find((n) => n.id === (p.data?.id ?? p.name));
          if (!nodeData) return '';
          const svc = nodeData.service;
          const lines = [
            `<strong>${svc.name}</strong>`,
            `Health: ${nodeData.health}`,
            `Alerts: ${svc.activeAlertCount}`,
            `SLOs: ${svc.sloCount}`,
          ];
          if (svc.worstErrorBudget !== undefined) {
            lines.push(`Error Budget: ${(svc.worstErrorBudget * 100).toFixed(1)}%`);
          }
          if (svc.dependencies.length > 0) {
            lines.push(`Dependencies: ${svc.dependencies.join(', ')}`);
          }
          if (nodeData.impacted) {
            lines.push('<span style="color: #BD271E">In blast radius</span>');
          }
          return lines.join('<br/>');
        },
      },
      series: [
        {
          type: 'graph',
          layout: 'force',
          roam: true,
          draggable: true,
          force: {
            repulsion: 300,
            edgeLength: [120, 250],
            gravity: 0.1,
            friction: 0.6,
          },
          data: nodes,
          links: edges,
          emphasis: {
            focus: 'adjacency',
            lineStyle: { width: 3 },
          },
          label: {
            position: 'inside',
          },
        },
      ],
      animation: true,
      animationDuration: 800,
    };
  }, [graph, selectedNodeId]);

  // Initialize ECharts instance
  useEffect(() => {
    if (!containerRef.current) return;

    instanceRef.current = echarts.init(containerRef.current);

    const resizeObserver = new ResizeObserver(() => {
      instanceRef.current?.resize();
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      instanceRef.current?.dispose();
      instanceRef.current = null;
    };
  }, []);

  // Apply spec
  useEffect(() => {
    if (instanceRef.current && spec) {
      instanceRef.current.setOption(spec, { notMerge: true });
    }
  }, [spec]);

  // Click handler
  useEffect(() => {
    const instance = instanceRef.current;
    if (!instance || !onNodeClick) return;

    const handler = (params: { dataType?: string; data?: { id?: string }; name?: string }) => {
      if (params.dataType === 'node') {
        const nodeId = params.data?.id ?? params.name;
        if (nodeId) onNodeClick(nodeId);
      }
    };

    instance.on('click', handler);
    return () => {
      instance.off('click', handler);
    };
  }, [onNodeClick]);

  return (
    <div ref={containerRef} style={{ height, width: '100%' }} data-test-subj="topology-graph" />
  );
};
