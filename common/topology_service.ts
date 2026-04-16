/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure functions for building and analyzing the service topology graph (Phase 5).
 *
 * No I/O — takes EnrichedOtelService[] and produces topology structures
 * suitable for visualization. All functions are stateless and testable.
 */

import type { EnrichedOtelService } from './types';
import type {
  TopologyNode,
  TopologyEdge,
  TopologyGraph,
  ActiveIncident,
  ServiceHealthLevel,
} from './topology_types';

// ============================================================================
// Health computation
// ============================================================================

/**
 * Compute health level from service enrichment data.
 *
 * Rules:
 *  - critical: any active alerts OR error budget < 10%
 *  - degraded: error budget between 10-30% (no active alerts)
 *  - healthy: error budget > 30% and no active alerts
 *  - unknown: no SLO data and no alerts
 */
export function computeHealthLevel(service: EnrichedOtelService): ServiceHealthLevel {
  if (service.activeAlertCount > 0) return 'critical';
  if (service.worstErrorBudget !== undefined) {
    if (service.worstErrorBudget < 0.1) return 'critical';
    if (service.worstErrorBudget < 0.3) return 'degraded';
    return 'healthy';
  }
  if (service.sloCount > 0) return 'healthy';
  return 'unknown';
}

// ============================================================================
// Graph construction
// ============================================================================

/**
 * Build a topology graph from enriched OTEL services.
 *
 * Creates nodes for every service and edges for every dependency relationship.
 * Only includes edges where both source and target are known services.
 */
export function buildTopologyGraph(services: EnrichedOtelService[]): TopologyGraph {
  const serviceMap = new Map<string, EnrichedOtelService>();
  for (const svc of services) {
    serviceMap.set(svc.name, svc);
  }

  const nodes: TopologyNode[] = services.map((svc) => ({
    id: svc.name,
    service: svc,
    health: computeHealthLevel(svc),
    impacted: false,
  }));

  const edges: TopologyEdge[] = [];
  for (const svc of services) {
    for (const dep of svc.dependencies) {
      // Only include edges where the target service is known
      if (serviceMap.has(dep)) {
        edges.push({
          source: svc.name,
          target: dep,
          impacted: false,
        });
      }
    }
  }

  return { nodes, edges };
}

// ============================================================================
// Blast radius
// ============================================================================

/**
 * Compute blast radius for a given service by traversing upstream callers.
 *
 * When a service (the "root") has firing alerts, any service that directly
 * or transitively depends on it may be impacted. This walks the reverse
 * dependency graph to find all upstream services.
 *
 * Returns a new graph with `impacted` flags set on affected nodes and edges.
 */
export function computeBlastRadius(graph: TopologyGraph, rootServiceName: string): TopologyGraph {
  // Build reverse adjacency: dependency -> callers[]
  const reverseAdj = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const callers = reverseAdj.get(edge.target) ?? [];
    callers.push(edge.source);
    reverseAdj.set(edge.target, callers);
  }

  // BFS from root through reverse edges
  const impactedSet = new Set<string>();
  const queue: string[] = [rootServiceName];
  impactedSet.add(rootServiceName);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const callers = reverseAdj.get(current) ?? [];
    for (const caller of callers) {
      if (!impactedSet.has(caller)) {
        impactedSet.add(caller);
        queue.push(caller);
      }
    }
  }

  // Mark impacted edges: both source and target must be in the impacted set,
  // and the edge must follow the blast radius path (target is closer to root)
  const impactedEdges = new Set<string>();
  for (const edge of graph.edges) {
    if (impactedSet.has(edge.source) && impactedSet.has(edge.target)) {
      impactedEdges.add(`${edge.source}->${edge.target}`);
    }
  }

  return {
    nodes: graph.nodes.map((n) => ({
      ...n,
      impacted: impactedSet.has(n.id),
    })),
    edges: graph.edges.map((e) => ({
      ...e,
      impacted: impactedEdges.has(`${e.source}->${e.target}`),
    })),
  };
}

/**
 * Compute blast radius for ALL services that currently have alerts.
 * The union of all individual blast radii is returned.
 */
export function computeFullBlastRadius(graph: TopologyGraph): TopologyGraph {
  const criticalNodes = graph.nodes.filter((n) => n.health === 'critical');
  if (criticalNodes.length === 0) return graph;

  // Union of all blast radii
  const allImpacted = new Set<string>();
  const allImpactedEdges = new Set<string>();

  // Build reverse adjacency once
  const reverseAdj = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const callers = reverseAdj.get(edge.target) ?? [];
    callers.push(edge.source);
    reverseAdj.set(edge.target, callers);
  }

  for (const root of criticalNodes) {
    const queue: string[] = [root.id];
    const visited = new Set<string>([root.id]);
    while (queue.length > 0) {
      const current = queue.shift()!;
      allImpacted.add(current);
      const callers = reverseAdj.get(current) ?? [];
      for (const caller of callers) {
        if (!visited.has(caller)) {
          visited.add(caller);
          queue.push(caller);
        }
      }
    }
  }

  for (const edge of graph.edges) {
    if (allImpacted.has(edge.source) && allImpacted.has(edge.target)) {
      allImpactedEdges.add(`${edge.source}->${edge.target}`);
    }
  }

  return {
    nodes: graph.nodes.map((n) => ({
      ...n,
      impacted: allImpacted.has(n.id),
    })),
    edges: graph.edges.map((e) => ({
      ...e,
      impacted: allImpactedEdges.has(`${e.source}->${e.target}`),
    })),
  };
}

// ============================================================================
// Active incidents
// ============================================================================

/**
 * Extract active incidents from the topology graph for the bottom panel.
 * An incident is any service with active alerts, along with its upstream
 * blast radius.
 */
export function extractActiveIncidents(graph: TopologyGraph): ActiveIncident[] {
  // Build reverse adjacency
  const reverseAdj = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const callers = reverseAdj.get(edge.target) ?? [];
    callers.push(edge.source);
    reverseAdj.set(edge.target, callers);
  }

  const incidents: ActiveIncident[] = [];

  for (const node of graph.nodes) {
    if (node.service.activeAlertCount === 0) continue;

    // Find upstream services (callers that depend on this service)
    const upstream: string[] = [];
    const queue: string[] = [node.id];
    const visited = new Set<string>([node.id]);
    while (queue.length > 0) {
      const current = queue.shift()!;
      const callers = reverseAdj.get(current) ?? [];
      for (const caller of callers) {
        if (!visited.has(caller)) {
          visited.add(caller);
          upstream.push(caller);
          queue.push(caller);
        }
      }
    }

    incidents.push({
      serviceName: node.id,
      health: node.health,
      alertCount: node.service.activeAlertCount,
      impactedUpstream: upstream,
      worstErrorBudget: node.service.worstErrorBudget,
    });
  }

  // Sort by alert count descending
  incidents.sort((a, b) => b.alertCount - a.alertCount);
  return incidents;
}
