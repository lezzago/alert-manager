/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Jest mock for @osd/apm-topology.
 *
 * CelestialMap depends on ReactFlow + canvas APIs that are unavailable in jsdom.
 * This mock renders a simple div tree that unit tests can query via data-test-subj.
 */

import React from 'react';

export const CelestialMap = ({ map, onDashboardClick, selectedNodeId }: any) => {
  const group = map?.default ?? { nodes: [], edges: [] };
  return (
    <div data-test-subj="celestial-map" data-selected={selectedNodeId}>
      {group.nodes.map((node: any) => (
        <div
          key={node.id}
          data-test-subj={`graph-node-${node.id}`}
          onClick={() => onDashboardClick?.(node.data)}
        />
      ))}
    </div>
  );
};
