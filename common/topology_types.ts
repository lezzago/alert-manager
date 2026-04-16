/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Types for the Service Health Dashboard topology visualization (Phase 5).
 *
 * The topology graph represents OTEL services as nodes and their dependency
 * relationships as directed edges. Each node is enriched with health status
 * derived from SLO attainment and active alert counts.
 */

import type { EnrichedOtelService } from './types';

// ============================================================================
// Health Status
// ============================================================================

/** Service health level derived from SLO attainment and alert state. */
export type ServiceHealthLevel = 'healthy' | 'degraded' | 'critical' | 'unknown';

/** Color mapping for health levels. */
export const HEALTH_COLORS: Record<ServiceHealthLevel, string> = {
  healthy: '#017D73',
  degraded: '#F5A700',
  critical: '#BD271E',
  unknown: '#98A2B3',
};

// ============================================================================
// Topology Graph
// ============================================================================

/** A node in the topology graph representing a single service. */
export interface TopologyNode {
  /** Service name (unique ID). */
  id: string;
  /** Full enriched service data. */
  service: EnrichedOtelService;
  /** Computed health level. */
  health: ServiceHealthLevel;
  /** Whether this node is in the blast radius of a selected incident. */
  impacted: boolean;
}

/** A directed edge from a service to one of its dependencies. */
export interface TopologyEdge {
  /** Source service name (the caller). */
  source: string;
  /** Target service name (the dependency). */
  target: string;
  /** Whether this edge is part of a blast radius path. */
  impacted: boolean;
}

/** Complete topology graph structure. */
export interface TopologyGraph {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}

// ============================================================================
// Active Incident (for bottom panel)
// ============================================================================

/** An active incident summary for the dashboard bottom panel. */
export interface ActiveIncident {
  /** Service with the firing alert. */
  serviceName: string;
  /** Health level of the affected service. */
  health: ServiceHealthLevel;
  /** Number of active alerts on this service. */
  alertCount: number;
  /** Services upstream that may be impacted (blast radius). */
  impactedUpstream: string[];
  /** Worst error budget remaining across the service's SLOs. */
  worstErrorBudget?: number;
}
