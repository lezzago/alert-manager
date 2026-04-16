/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { EnrichedOtelService } from '../types';
import type { TopologyGraph } from '../topology_types';
import {
  computeHealthLevel,
  buildTopologyGraph,
  computeBlastRadius,
  computeFullBlastRadius,
  extractActiveIncidents,
} from '../topology_service';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeService(
  overrides: Partial<EnrichedOtelService> & { name: string }
): EnrichedOtelService {
  return {
    environment: 'production',
    dependencies: [],
    lastSeen: '2024-01-01T00:00:00Z',
    sloCount: 0,
    activeAlertCount: 0,
    signals: { hasTraces: true, hasLogs: true, hasMetrics: true },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// computeHealthLevel
// ---------------------------------------------------------------------------

describe('computeHealthLevel', () => {
  it('returns critical when service has active alerts', () => {
    const svc = makeService({ name: 'api-gateway', activeAlertCount: 2 });
    expect(computeHealthLevel(svc)).toBe('critical');
  });

  it('returns critical when error budget is below 10%', () => {
    const svc = makeService({ name: 'payment', sloCount: 1, worstErrorBudget: 0.05 });
    expect(computeHealthLevel(svc)).toBe('critical');
  });

  it('returns degraded when error budget is between 10-30%', () => {
    const svc = makeService({ name: 'order', sloCount: 1, worstErrorBudget: 0.2 });
    expect(computeHealthLevel(svc)).toBe('degraded');
  });

  it('returns healthy when error budget is above 30%', () => {
    const svc = makeService({ name: 'user-auth', sloCount: 1, worstErrorBudget: 0.8 });
    expect(computeHealthLevel(svc)).toBe('healthy');
  });

  it('returns healthy when SLOs exist but no error budget data', () => {
    const svc = makeService({ name: 'checkout', sloCount: 2 });
    expect(computeHealthLevel(svc)).toBe('healthy');
  });

  it('returns unknown when no SLOs and no alerts', () => {
    const svc = makeService({ name: 'postgres' });
    expect(computeHealthLevel(svc)).toBe('unknown');
  });

  it('prioritizes active alerts over error budget', () => {
    const svc = makeService({
      name: 'api-gateway',
      activeAlertCount: 1,
      sloCount: 1,
      worstErrorBudget: 0.9, // would be healthy without alerts
    });
    expect(computeHealthLevel(svc)).toBe('critical');
  });
});

// ---------------------------------------------------------------------------
// buildTopologyGraph
// ---------------------------------------------------------------------------

describe('buildTopologyGraph', () => {
  const services: EnrichedOtelService[] = [
    makeService({ name: 'frontend', dependencies: ['api-gateway'] }),
    makeService({ name: 'api-gateway', dependencies: ['payment', 'order'] }),
    makeService({ name: 'payment', dependencies: ['postgres'] }),
    makeService({ name: 'order', dependencies: ['postgres'] }),
    makeService({ name: 'postgres', dependencies: [] }),
  ];

  it('creates a node for each service', () => {
    const graph = buildTopologyGraph(services);
    expect(graph.nodes).toHaveLength(5);
    expect(graph.nodes.map((n) => n.id)).toEqual([
      'frontend',
      'api-gateway',
      'payment',
      'order',
      'postgres',
    ]);
  });

  it('creates edges for known dependencies', () => {
    const graph = buildTopologyGraph(services);
    expect(graph.edges).toHaveLength(5);
    expect(graph.edges).toContainEqual(
      expect.objectContaining({ source: 'frontend', target: 'api-gateway' })
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({ source: 'api-gateway', target: 'payment' })
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({ source: 'payment', target: 'postgres' })
    );
  });

  it('omits edges to unknown services', () => {
    const svcs = [
      makeService({ name: 'a', dependencies: ['b', 'unknown-service'] }),
      makeService({ name: 'b', dependencies: [] }),
    ];
    const graph = buildTopologyGraph(svcs);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({ source: 'a', target: 'b' });
  });

  it('sets impacted to false by default', () => {
    const graph = buildTopologyGraph(services);
    expect(graph.nodes.every((n) => !n.impacted)).toBe(true);
    expect(graph.edges.every((e) => !e.impacted)).toBe(true);
  });

  it('computes health level for each node', () => {
    const svcs = [
      makeService({ name: 'critical-svc', activeAlertCount: 3 }),
      makeService({ name: 'healthy-svc', sloCount: 1, worstErrorBudget: 0.9 }),
      makeService({ name: 'unknown-svc' }),
    ];
    const graph = buildTopologyGraph(svcs);
    expect(graph.nodes.find((n) => n.id === 'critical-svc')?.health).toBe('critical');
    expect(graph.nodes.find((n) => n.id === 'healthy-svc')?.health).toBe('healthy');
    expect(graph.nodes.find((n) => n.id === 'unknown-svc')?.health).toBe('unknown');
  });

  it('handles empty service list', () => {
    const graph = buildTopologyGraph([]);
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// computeBlastRadius
// ---------------------------------------------------------------------------

describe('computeBlastRadius', () => {
  // Graph: frontend -> api-gateway -> payment -> postgres
  //                                -> order   -> postgres
  //        notification (isolated)
  const services: EnrichedOtelService[] = [
    makeService({ name: 'frontend', dependencies: ['api-gateway'] }),
    makeService({ name: 'api-gateway', dependencies: ['payment', 'order'] }),
    makeService({ name: 'payment', dependencies: ['postgres'] }),
    makeService({ name: 'order', dependencies: ['postgres'] }),
    makeService({ name: 'postgres', dependencies: [] }),
    makeService({ name: 'notification', dependencies: [] }),
  ];

  let baseGraph: TopologyGraph;

  beforeEach(() => {
    baseGraph = buildTopologyGraph(services);
  });

  it('marks the root service as impacted', () => {
    const result = computeBlastRadius(baseGraph, 'postgres');
    expect(result.nodes.find((n) => n.id === 'postgres')?.impacted).toBe(true);
  });

  it('propagates upstream through reverse dependencies', () => {
    // postgres is a dependency of payment and order, which are deps of api-gateway,
    // which is a dep of frontend. All should be impacted.
    const result = computeBlastRadius(baseGraph, 'postgres');
    const impacted = result.nodes.filter((n) => n.impacted).map((n) => n.id);
    expect(impacted).toContain('postgres');
    expect(impacted).toContain('payment');
    expect(impacted).toContain('order');
    expect(impacted).toContain('api-gateway');
    expect(impacted).toContain('frontend');
  });

  it('does not mark isolated services as impacted', () => {
    const result = computeBlastRadius(baseGraph, 'postgres');
    expect(result.nodes.find((n) => n.id === 'notification')?.impacted).toBe(false);
  });

  it('marks edges within blast radius as impacted', () => {
    const result = computeBlastRadius(baseGraph, 'payment');
    const impactedEdges = result.edges.filter((e) => e.impacted);
    expect(impactedEdges.length).toBeGreaterThan(0);
    expect(impactedEdges).toContainEqual(
      expect.objectContaining({ source: 'api-gateway', target: 'payment', impacted: true })
    );
  });

  it('limits blast radius to direct upstream for leaf-adjacent service', () => {
    const result = computeBlastRadius(baseGraph, 'order');
    const impacted = result.nodes.filter((n) => n.impacted).map((n) => n.id);
    expect(impacted).toContain('order');
    expect(impacted).toContain('api-gateway');
    expect(impacted).toContain('frontend');
    // payment and postgres are NOT upstream of order
    expect(impacted).not.toContain('payment');
    // postgres is downstream of order, not upstream
    expect(impacted).not.toContain('postgres');
  });

  it('handles blast radius of a root-level service', () => {
    const result = computeBlastRadius(baseGraph, 'frontend');
    const impacted = result.nodes.filter((n) => n.impacted).map((n) => n.id);
    // Only frontend itself — nothing depends on it
    expect(impacted).toEqual(['frontend']);
  });
});

// ---------------------------------------------------------------------------
// computeFullBlastRadius
// ---------------------------------------------------------------------------

describe('computeFullBlastRadius', () => {
  it('computes union of blast radii for all critical services', () => {
    const services = [
      makeService({ name: 'frontend', dependencies: ['api-gateway'] }),
      makeService({ name: 'api-gateway', dependencies: ['payment', 'order'] }),
      makeService({ name: 'payment', dependencies: [], activeAlertCount: 1 }), // critical
      makeService({ name: 'order', dependencies: [] }),
      makeService({ name: 'notification', dependencies: [] }),
    ];
    const graph = buildTopologyGraph(services);
    const result = computeFullBlastRadius(graph);

    // payment (critical) -> upstream: api-gateway, frontend
    const impacted = result.nodes.filter((n) => n.impacted).map((n) => n.id);
    expect(impacted).toContain('payment');
    expect(impacted).toContain('api-gateway');
    expect(impacted).toContain('frontend');
    expect(impacted).not.toContain('notification');
  });

  it('returns unchanged graph when no critical services', () => {
    const services = [
      makeService({ name: 'a', dependencies: ['b'], sloCount: 1, worstErrorBudget: 0.9 }),
      makeService({ name: 'b', dependencies: [] }),
    ];
    const graph = buildTopologyGraph(services);
    const result = computeFullBlastRadius(graph);
    expect(result.nodes.every((n) => !n.impacted)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// extractActiveIncidents
// ---------------------------------------------------------------------------

describe('extractActiveIncidents', () => {
  it('creates incidents for services with active alerts', () => {
    const services = [
      makeService({ name: 'frontend', dependencies: ['api-gateway'] }),
      makeService({ name: 'api-gateway', dependencies: ['payment'], activeAlertCount: 2 }),
      makeService({ name: 'payment', dependencies: [], activeAlertCount: 1 }),
    ];
    const graph = buildTopologyGraph(services);
    const incidents = extractActiveIncidents(graph);

    expect(incidents).toHaveLength(2);
    expect(incidents[0].serviceName).toBe('api-gateway'); // more alerts, sorted first
    expect(incidents[0].alertCount).toBe(2);
    expect(incidents[1].serviceName).toBe('payment');
    expect(incidents[1].alertCount).toBe(1);
  });

  it('computes upstream blast radius for each incident', () => {
    const services = [
      makeService({ name: 'frontend', dependencies: ['api-gateway'] }),
      makeService({ name: 'api-gateway', dependencies: ['payment'] }),
      makeService({ name: 'payment', dependencies: [], activeAlertCount: 1 }),
    ];
    const graph = buildTopologyGraph(services);
    const incidents = extractActiveIncidents(graph);

    const paymentIncident = incidents.find((i) => i.serviceName === 'payment');
    expect(paymentIncident?.impactedUpstream).toContain('api-gateway');
    expect(paymentIncident?.impactedUpstream).toContain('frontend');
  });

  it('returns empty array when no active incidents', () => {
    const services = [
      makeService({ name: 'a', dependencies: ['b'] }),
      makeService({ name: 'b', dependencies: [] }),
    ];
    const graph = buildTopologyGraph(services);
    expect(extractActiveIncidents(graph)).toHaveLength(0);
  });

  it('includes worst error budget in incident', () => {
    const services = [
      makeService({
        name: 'api-gateway',
        dependencies: [],
        activeAlertCount: 1,
        sloCount: 2,
        worstErrorBudget: 0.05,
      }),
    ];
    const graph = buildTopologyGraph(services);
    const incidents = extractActiveIncidents(graph);
    expect(incidents[0].worstErrorBudget).toBe(0.05);
  });
});
