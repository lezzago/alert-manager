/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  EuiButton,
  EuiFlexGroup,
  EuiFlexItem,
  EuiIcon,
  EuiLink,
  EuiSpacer,
  EuiTab,
  EuiTabs,
  EuiText,
} from '@elastic/eui';

interface TabContent {
  id: string;
  name: string;
  icon: string;
  description: string;
}

const tabs: TabContent[] = [
  {
    id: 'services',
    name: 'Services',
    icon: 'compute',
    description:
      'Monitor all your OpenTelemetry-instrumented services in one place. ' +
      'See active alerts, SLO coverage, error budgets, and signal availability at a glance.',
  },
  {
    id: 'topology',
    name: 'Topology',
    icon: 'graphApp',
    description:
      'Visualize service dependencies as an interactive topology map. ' +
      'Identify blast radius of incidents and trace upstream/downstream impacts.',
  },
  {
    id: 'slo-coverage',
    name: 'SLO Coverage',
    icon: 'visGoal',
    description:
      'Analyze SLO coverage gaps across your service fleet. ' +
      'Get intelligent SLO suggestions based on detected signal patterns and industry best practices.',
  },
];

interface ServicesEmptyStateProps {
  onGetStarted?: () => void;
}

export const ServicesEmptyState: React.FC<ServicesEmptyStateProps> = ({ onGetStarted }) => {
  const [selectedTabId, setSelectedTabId] = useState('services');
  const selectedTab = tabs.find((t) => t.id === selectedTabId) || tabs[0];

  return (
    <EuiFlexGroup
      direction="column"
      alignItems="center"
      gutterSize="none"
      data-test-subj="services-empty-state"
    >
      <EuiFlexItem grow={false}>
        <EuiSpacer size="xxl" />

        <EuiFlexGroup justifyContent="center" gutterSize="s" alignItems="center">
          <EuiFlexItem grow={false}>
            <EuiIcon type="compute" size="xl" color="primary" />
          </EuiFlexItem>
        </EuiFlexGroup>

        <EuiSpacer size="m" />

        <EuiText textAlign="center">
          <h2>Get started with Service Monitoring</h2>
        </EuiText>

        <EuiSpacer size="s" />

        <EuiText textAlign="center" color="subdued" size="s">
          <p>
            Connect your OpenTelemetry-instrumented services to gain full observability — alerts,
            SLOs, topology maps, and intelligent root cause analysis.
          </p>
        </EuiText>

        <EuiSpacer size="l" />

        <EuiFlexGroup justifyContent="center" gutterSize="m">
          <EuiFlexItem grow={false}>
            <EuiButton
              fill
              iconType="plusInCircle"
              onClick={onGetStarted}
              data-test-subj="services-get-started-btn"
            >
              Get Started
            </EuiButton>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiLink
              href="https://opensearch.org/docs/latest/observing-your-data/ad/index/"
              target="_blank"
              external
            >
              View Documentation
            </EuiLink>
          </EuiFlexItem>
        </EuiFlexGroup>

        <EuiSpacer size="xl" />

        <EuiTabs>
          {tabs.map((tab) => (
            <EuiTab
              key={tab.id}
              onClick={() => setSelectedTabId(tab.id)}
              isSelected={tab.id === selectedTabId}
              data-test-subj={`empty-state-tab-${tab.id}`}
            >
              {tab.name}
            </EuiTab>
          ))}
        </EuiTabs>

        <EuiSpacer size="m" />

        <EuiFlexGroup justifyContent="center" gutterSize="m" alignItems="center">
          <EuiFlexItem grow={false}>
            <EuiIcon type={selectedTab.icon} size="l" color="subdued" />
          </EuiFlexItem>
        </EuiFlexGroup>

        <EuiSpacer size="s" />

        <EuiText
          textAlign="center"
          color="subdued"
          size="s"
          style={{ maxWidth: 600, margin: '0 auto' }}
        >
          <p>{selectedTab.description}</p>
        </EuiText>

        <EuiSpacer size="l" />

        {/* Setup steps */}
        <EuiText size="s" style={{ maxWidth: 500, margin: '0 auto' }}>
          <ol>
            <li>
              <strong>Instrument your services</strong> with OpenTelemetry SDKs
            </li>
            <li>
              <strong>Configure Data Prepper</strong> to populate the service map index
            </li>
            <li>
              <strong>Set up APM</strong> in the Observability plugin to enable trace/log
              correlation
            </li>
          </ol>
        </EuiText>

        <EuiSpacer size="xxl" />
      </EuiFlexItem>
    </EuiFlexGroup>
  );
};
