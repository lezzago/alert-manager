/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { groupIncidents, findRootService } from '../incident_grouping_service';
import type { ActiveIncident, TopologyGraph, TopologyNode, TopologyEdge } from '../topology_types';
import type { EnrichedOtelService } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIncident(overrides: Partial<ActiveIncident> = {}): ActiveIncident {
  return {
    serviceName: 'svc-a',
    health: 'critical',
    alertCount: 1,
    impactedUpstream: [],
    worstErrorBudget: 0.05,
    ...overrides,
  };
}

function makeService(name: string): EnrichedOtelService {
  return {
    name,
    environment: 'production',
    type: 'Service',
    sdkLanguage: 'java',
    dependencies: [],
    lastSeen: new Date().toISOString(),
    sloCount: 0,
    activeAlertCount: 0,
    signals: { hasTraces: true, hasLogs: true, hasMetrics: true },
  };
}

function makeNode(name: string): TopologyNode {
  return {
    id: name,
    service: makeService(name),
    health: 'healthy',
    impacted: false,
  };
}

function makeGraph(nodeNames: string[], edges: Array<[string, string]>): TopologyGraph {
  return {
    nodes: nodeNames.map(makeNode),
    edges: edges.map(
      ([s, t]): TopologyEdge => ({
        source: s,
        target: t,
        impacted: false,
      })
    ),
  };
}

// ---------------------------------------------------------------------------
// findRootService
// ---------------------------------------------------------------------------

describe('findRootService', () => {
  it('returns the only service when single', () => {
    const graph = makeGraph(['svc-a'], []);
    expect(findRootService(['svc-a'], graph)).toBe('svc-a');
  });

  it('returns the deepest dependency', () => {
    // A → B → C (A depends on B, B depends on C)
    const graph = makeGraph(
      ['svc-a', 'svc-b', 'svc-c'],
      [
        ['svc-a', 'svc-b'],
        ['svc-b', 'svc-c'],
      ]
    );
    expect(findRootService(['svc-a', 'svc-b', 'svc-c'], graph)).toBe('svc-c');
  });

  it('returns deepest even when not all in chain have alerts', () => {
    // A → B → C, but only B and C have incidents
    const graph = makeGraph(
      ['svc-a', 'svc-b', 'svc-c'],
      [
        ['svc-a', 'svc-b'],
        ['svc-b', 'svc-c'],
      ]
    );
    expect(findRootService(['svc-b', 'svc-c'], graph)).toBe('svc-c');
  });
});

// ---------------------------------------------------------------------------
// groupIncidents
// ---------------------------------------------------------------------------

describe('groupIncidents', () => {
  it('returns empty array for no incidents', () => {
    const graph = makeGraph(['svc-a'], []);
    expect(groupIncidents([], graph)).toHaveLength(0);
  });

  it('wraps single incident in a group', () => {
    const graph = makeGraph(['svc-a'], []);
    const incidents = [makeIncident({ serviceName: 'svc-a', alertCount: 3 })];
    const groups = groupIncidents(incidents, graph);
    expect(groups).toHaveLength(1);
    expect(groups[0].rootService).toBe('svc-a');
    expect(groups[0].totalAlertCount).toBe(3);
    expect(groups[0].rootCauseConfidence).toBe('high');
  });

  it('groups directly connected incidents', () => {
    // A → B (A depends on B, both have alerts)
    const graph = makeGraph(['svc-a', 'svc-b'], [['svc-a', 'svc-b']]);
    const incidents = [
      makeIncident({ serviceName: 'svc-a', alertCount: 2 }),
      makeIncident({ serviceName: 'svc-b', alertCount: 3 }),
    ];
    const groups = groupIncidents(incidents, graph);
    expect(groups).toHaveLength(1);
    expect(groups[0].rootService).toBe('svc-b');
    expect(groups[0].totalAlertCount).toBe(5);
  });

  it('groups transitive dependencies', () => {
    // A → B → C (all have alerts)
    const graph = makeGraph(
      ['svc-a', 'svc-b', 'svc-c'],
      [
        ['svc-a', 'svc-b'],
        ['svc-b', 'svc-c'],
      ]
    );
    const incidents = [
      makeIncident({ serviceName: 'svc-a', alertCount: 1 }),
      makeIncident({ serviceName: 'svc-b', alertCount: 2 }),
      makeIncident({ serviceName: 'svc-c', alertCount: 3 }),
    ];
    const groups = groupIncidents(incidents, graph);
    expect(groups).toHaveLength(1);
    expect(groups[0].rootService).toBe('svc-c');
    expect(groups[0].totalAlertCount).toBe(6);
  });

  it('does not group unconnected incidents', () => {
    // A and B have no dependency relationship
    const graph = makeGraph(['svc-a', 'svc-b'], []);
    const incidents = [
      makeIncident({ serviceName: 'svc-a', alertCount: 1 }),
      makeIncident({ serviceName: 'svc-b', alertCount: 2 }),
    ];
    const groups = groupIncidents(incidents, graph);
    expect(groups).toHaveLength(2);
  });

  it('sorts groups by total alert count descending', () => {
    // Two independent groups
    const graph = makeGraph(
      ['svc-a', 'svc-b', 'svc-c', 'svc-d'],
      [
        ['svc-a', 'svc-b'],
        ['svc-c', 'svc-d'],
      ]
    );
    const incidents = [
      makeIncident({ serviceName: 'svc-a', alertCount: 1 }),
      makeIncident({ serviceName: 'svc-b', alertCount: 1 }),
      makeIncident({ serviceName: 'svc-c', alertCount: 5 }),
      makeIncident({ serviceName: 'svc-d', alertCount: 5 }),
    ];
    const groups = groupIncidents(incidents, graph);
    expect(groups).toHaveLength(2);
    expect(groups[0].totalAlertCount).toBe(10);
    expect(groups[1].totalAlertCount).toBe(2);
  });

  it('collects affected services from all member upstream lists', () => {
    const graph = makeGraph(['svc-a', 'svc-b', 'svc-c'], [['svc-a', 'svc-b']]);
    const incidents = [
      makeIncident({ serviceName: 'svc-a', alertCount: 1, impactedUpstream: [] }),
      makeIncident({ serviceName: 'svc-b', alertCount: 2, impactedUpstream: ['svc-c'] }),
    ];
    const groups = groupIncidents(incidents, graph);
    expect(groups[0].affectedServices).toContain('svc-a');
    expect(groups[0].affectedServices).toContain('svc-b');
    expect(groups[0].affectedServices).toContain('svc-c');
  });

  it('assigns high confidence for clear chain', () => {
    const graph = makeGraph(['svc-a', 'svc-b'], [['svc-a', 'svc-b']]);
    const incidents = [
      makeIncident({ serviceName: 'svc-a', alertCount: 1 }),
      makeIncident({ serviceName: 'svc-b', alertCount: 1 }),
    ];
    const groups = groupIncidents(incidents, graph);
    expect(groups[0].rootCauseConfidence).toBe('high');
  });
});
