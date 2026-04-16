/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen, fireEvent, configure } from '@testing-library/react';
import { ServiceHealthDashboard } from '../service_health_dashboard';
import type { EnrichedOtelService } from '../../../common/types';

// OSD uses data-test-subj instead of data-testid
configure({ testIdAttribute: 'data-test-subj' });

// Mock the TopologyGraphView since it depends on ECharts (canvas-based, unavailable in jsdom)
jest.mock('../topology_graph', () => ({
  TopologyGraphView: ({ graph, onNodeClick, selectedNodeId }: any) => (
    <div data-test-subj="topology-graph" data-selected={selectedNodeId}>
      {graph.nodes.map((n: any) => (
        <div key={n.id} data-test-subj={`graph-node-${n.id}`} onClick={() => onNodeClick?.(n.id)} />
      ))}
    </div>
  ),
}));

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

const mockServices: EnrichedOtelService[] = [
  makeService({
    name: 'api-gateway',
    dependencies: ['payment-service', 'order-service'],
    sloCount: 2,
    activeAlertCount: 0,
    worstErrorBudget: 0.85,
  }),
  makeService({
    name: 'payment-service',
    dependencies: ['postgres'],
    sloCount: 1,
    activeAlertCount: 2,
    worstErrorBudget: 0.05,
  }),
  makeService({
    name: 'order-service',
    dependencies: ['postgres'],
    sloCount: 1,
    activeAlertCount: 0,
    worstErrorBudget: 0.7,
  }),
  makeService({
    name: 'postgres',
    dependencies: [],
    type: 'Database',
  }),
  makeService({
    name: 'notification-service',
    dependencies: [],
    sloCount: 0,
    activeAlertCount: 0,
  }),
];

describe('ServiceHealthDashboard', () => {
  it('renders the dashboard with all three panels', () => {
    render(<ServiceHealthDashboard services={mockServices} />);

    expect(screen.getByTestId('service-health-dashboard')).toBeDefined();
    expect(screen.getByTestId('topology-graph')).toBeDefined();
    expect(screen.getByTestId('topology-incidents-panel')).toBeDefined();
  });

  it('renders service list in left panel', () => {
    render(<ServiceHealthDashboard services={mockServices} />);

    expect(screen.getByTestId('topology-service-item-api-gateway')).toBeDefined();
    expect(screen.getByTestId('topology-service-item-payment-service')).toBeDefined();
    expect(screen.getByTestId('topology-service-item-order-service')).toBeDefined();
    expect(screen.getByTestId('topology-service-item-postgres')).toBeDefined();
    expect(screen.getByTestId('topology-service-item-notification-service')).toBeDefined();
  });

  it('sorts services with critical health first', () => {
    render(<ServiceHealthDashboard services={mockServices} />);

    const items = screen.getAllByTestId(/^topology-service-item-/);
    // payment-service has active alerts (critical) — should be first
    expect(items[0].getAttribute('data-test-subj')).toBe('topology-service-item-payment-service');
  });

  it('shows active incidents for services with alerts', () => {
    render(<ServiceHealthDashboard services={mockServices} />);

    expect(screen.getByTestId('topology-incident-group-payment-service')).toBeDefined();
    expect(screen.getByText(/2 alert/)).toBeDefined();
  });

  it('shows no incidents message when all healthy', () => {
    const healthyServices = mockServices.map((s) => ({
      ...s,
      activeAlertCount: 0,
    }));
    render(<ServiceHealthDashboard services={healthyServices} />);

    expect(screen.getByTestId('topology-no-incidents')).toBeDefined();
  });

  it('shows blast radius in incident cards', () => {
    render(<ServiceHealthDashboard services={mockServices} />);

    const incident = screen.getByTestId('topology-incident-group-payment-service');
    // api-gateway depends on payment-service, so it's in the blast radius
    expect(incident.textContent).toContain('api-gateway');
  });

  it('calls onServiceSelect when a service in list is clicked', () => {
    const onServiceSelect = jest.fn();
    render(<ServiceHealthDashboard services={mockServices} onServiceSelect={onServiceSelect} />);

    fireEvent.click(screen.getByTestId('topology-service-item-api-gateway'));
    expect(onServiceSelect).toHaveBeenCalledWith('api-gateway');
  });

  it('renders empty state when no services', () => {
    render(<ServiceHealthDashboard services={[]} />);
    expect(screen.getByTestId('topology-empty-state')).toBeDefined();
  });

  it('has a service search filter', () => {
    render(<ServiceHealthDashboard services={mockServices} />);
    expect(screen.getByTestId('topology-service-search')).toBeDefined();
  });

  it('shows error budget percentage in service list items', () => {
    render(<ServiceHealthDashboard services={mockServices} />);

    const apiGateway = screen.getByTestId('topology-service-item-api-gateway');
    expect(apiGateway.textContent).toContain('85%');
  });

  it('shows incident group confidence badge', () => {
    render(<ServiceHealthDashboard services={mockServices} />);

    const confidenceBadge = screen.getByTestId('incident-group-confidence-payment-service');
    expect(confidenceBadge).toBeDefined();
  });

  it('passes nodes to topology graph', () => {
    render(<ServiceHealthDashboard services={mockServices} />);

    // Our TopologyGraphView mock renders graph-node-{id} divs
    expect(screen.getByTestId('graph-node-api-gateway')).toBeDefined();
    expect(screen.getByTestId('graph-node-payment-service')).toBeDefined();
  });

  it('calls onServiceSelect when a graph node is clicked', () => {
    const onServiceSelect = jest.fn();
    render(<ServiceHealthDashboard services={mockServices} onServiceSelect={onServiceSelect} />);

    fireEvent.click(screen.getByTestId('graph-node-order-service'));
    expect(onServiceSelect).toHaveBeenCalledWith('order-service');
  });

  it('shows health legend', () => {
    render(<ServiceHealthDashboard services={mockServices} />);
    expect(screen.getByText('Healthy')).toBeDefined();
    expect(screen.getByText('Degraded')).toBeDefined();
    expect(screen.getByText('Critical')).toBeDefined();
  });
});
