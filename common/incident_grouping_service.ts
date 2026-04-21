/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Cross-Service Incident Grouping (Phase 6.4).
 *
 * Pure functions that group co-firing alerts on related services into
 * incident groups using the dependency graph. No I/O.
 */

import type { ActiveIncident, TopologyGraph } from './topology_types';
import type { IncidentGroup, RootCauseConfidence } from './root_cause_types';

// ============================================================================
// Root service identification
// ============================================================================

/**
 * Find the root service among a set of alerting services.
 *
 * The "root" is the deepest service in the dependency chain — the one that
 * other alerting services (directly or transitively) depend on. If A → B → C
 * and B and C both have alerts, C is the root because B depends on C.
 *
 * Approach: for each candidate service, count how many other candidates
 * depend on it (transitively). The service with the most dependents is the root.
 */
export function findRootService(incidentServiceNames: string[], graph: TopologyGraph): string {
  if (incidentServiceNames.length <= 1) {
    return incidentServiceNames[0] ?? '';
  }

  const candidateSet = new Set(incidentServiceNames);

  // Build forward adjacency: source → targets (source depends on target)
  const forwardAdj = buildForwardAdj(graph);

  // Build reachability sets once per candidate via BFS — O(N * (N+E))
  const reachableFrom = new Map<string, Set<string>>();
  for (const candidate of incidentServiceNames) {
    const reachable = new Set<string>();
    const queue = [candidate];
    const visited = new Set<string>([candidate]);
    while (queue.length > 0) {
      const current = queue.shift()!;
      const deps = forwardAdj.get(current) ?? [];
      for (const dep of deps) {
        if (!visited.has(dep)) {
          visited.add(dep);
          reachable.add(dep);
          queue.push(dep);
        }
      }
    }
    reachableFrom.set(candidate, reachable);
  }

  // For each candidate, count how many other candidates transitively depend on it
  // using precomputed reachability — O(1) per pair
  const dependentCount = new Map<string, number>();

  for (const candidate of incidentServiceNames) {
    let count = 0;
    for (const other of incidentServiceNames) {
      if (other === candidate) continue;
      if (reachableFrom.get(other)!.has(candidate)) {
        count++;
      }
    }
    dependentCount.set(candidate, count);
  }

  // Service with most dependents is root; break ties by name for determinism
  let root = incidentServiceNames[0];
  let maxDeps = dependentCount.get(root) ?? 0;

  for (const name of incidentServiceNames) {
    const deps = dependentCount.get(name) ?? 0;
    if (deps > maxDeps || (deps === maxDeps && name < root)) {
      root = name;
      maxDeps = deps;
    }
  }

  return root;
}

// ============================================================================
// Incident grouping
// ============================================================================

/**
 * Group co-firing incidents on related services into incident groups.
 *
 * Two incidents are in the same group if their services are connected
 * (directly or transitively) in the dependency graph. Uses union-find
 * on the subgraph restricted to services with active incidents.
 */
export function groupIncidents(incidents: ActiveIncident[], graph: TopologyGraph): IncidentGroup[] {
  if (incidents.length === 0) return [];
  if (incidents.length === 1) {
    const inc = incidents[0];
    return [
      {
        id: `group-${inc.serviceName}`,
        rootService: inc.serviceName,
        rootHealth: inc.health,
        affectedServices: [inc.serviceName, ...inc.impactedUpstream],
        totalAlertCount: inc.alertCount,
        rootCauseConfidence: 'high',
        incidents: [inc],
      },
    ];
  }

  const incidentMap = new Map<string, ActiveIncident>();
  for (const inc of incidents) {
    incidentMap.set(inc.serviceName, inc);
  }

  const incidentNames = new Set(incidentMap.keys());

  // Union-find over incident services connected by edges
  const parent = new Map<string, string>();
  for (const name of incidentNames) {
    parent.set(name, name);
  }

  function find(x: string): string {
    while (parent.get(x) !== x) {
      const p = parent.get(parent.get(x)!)!;
      parent.set(x, p);
      x = p;
    }
    return x;
  }

  function union(a: string, b: string): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  // Union incident services that are connected by dependency edges
  for (const edge of graph.edges) {
    if (incidentNames.has(edge.source) && incidentNames.has(edge.target)) {
      union(edge.source, edge.target);
    }
  }

  // Build transitive reachability sets once per incident service (O(N * (N+E)))
  // instead of checking every pair with a fresh BFS (O(N^2 * (N+E)))
  const forwardAdj = buildForwardAdj(graph);
  const reachableFrom = new Map<string, Set<string>>();
  for (const name of incidentNames) {
    const reachable = new Set<string>();
    const queue = [name];
    const visited = new Set<string>([name]);
    while (queue.length > 0) {
      const current = queue.shift()!;
      const deps = forwardAdj.get(current) ?? [];
      for (const dep of deps) {
        if (!visited.has(dep)) {
          visited.add(dep);
          reachable.add(dep);
          queue.push(dep);
        }
      }
    }
    reachableFrom.set(name, reachable);
  }

  // Also union services that are transitively connected through non-incident nodes
  // Using precomputed reachability for O(1) lookups per pair
  for (const nameA of incidentNames) {
    for (const nameB of incidentNames) {
      if (nameA >= nameB) continue;
      if (find(nameA) === find(nameB)) continue;
      const aReaches = reachableFrom.get(nameA)!;
      const bReaches = reachableFrom.get(nameB)!;
      if (aReaches.has(nameB) || bReaches.has(nameA)) {
        union(nameA, nameB);
      }
    }
  }

  // Collect groups by root representative
  const groupMap = new Map<string, string[]>();
  for (const name of incidentNames) {
    const root = find(name);
    const group = groupMap.get(root) ?? [];
    group.push(name);
    groupMap.set(root, group);
  }

  // Build IncidentGroup for each cluster
  const result: IncidentGroup[] = [];

  for (const members of groupMap.values()) {
    const rootService = findRootService(members, graph);
    const rootIncident = incidentMap.get(rootService)!;

    // Collect all affected services (union of all members' upstream)
    const allAffected = new Set<string>(members);
    for (const m of members) {
      const inc = incidentMap.get(m)!;
      for (const up of inc.impactedUpstream) {
        allAffected.add(up);
      }
    }

    const totalAlerts = members.reduce((sum, m) => sum + (incidentMap.get(m)?.alertCount ?? 0), 0);

    const confidence = computeGroupConfidence(members, graph);

    result.push({
      id: `group-${rootService}`,
      rootService,
      rootHealth: rootIncident.health,
      affectedServices: Array.from(allAffected),
      totalAlertCount: totalAlerts,
      rootCauseConfidence: confidence,
      incidents: members.map((m) => incidentMap.get(m)!),
    });
  }

  // Sort by total alert count descending
  result.sort((a, b) => b.totalAlertCount - a.totalAlertCount);
  return result;
}

// ============================================================================
// Helpers
// ============================================================================

function buildForwardAdj(graph: TopologyGraph): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const deps = adj.get(edge.source) ?? [];
    deps.push(edge.target);
    adj.set(edge.source, deps);
  }
  return adj;
}

/**
 * Compute confidence that a group of incidents shares a root cause.
 *
 * - high: clear single chain (one service that others depend on)
 * - medium: connected but multiple potential roots
 * - low: weakly connected
 */
function computeGroupConfidence(members: string[], graph: TopologyGraph): RootCauseConfidence {
  if (members.length === 1) return 'high';

  const forwardAdj = buildForwardAdj(graph);
  let directConnections = 0;

  for (const a of members) {
    for (const b of members) {
      if (a === b) continue;
      const deps = forwardAdj.get(a) ?? [];
      if (deps.includes(b)) directConnections++;
    }
  }

  // Strong: at least one direct dependency per pair direction
  if (directConnections >= members.length - 1) return 'high';

  // Some connections
  if (directConnections > 0) return 'medium';

  return 'low';
}
