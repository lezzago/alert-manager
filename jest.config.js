/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

module.exports = {
  projects: [
    // Server-side and common tests (node environment)
    {
      displayName: 'server',
      preset: 'ts-jest',
      testEnvironment: 'node',
      roots: ['<rootDir>/common', '<rootDir>/server'],
      testMatch: ['**/__tests__/**/*.test.ts'],
      moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
      transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.test.json', diagnostics: false }],
      },
      moduleNameMapper: {
        // Map OSD core server imports to local mock (not available outside the OSD monorepo)
        '^opensearch-dashboards/server$': '<rootDir>/server/__mocks__/osd_server.ts',
      },
    },
    // React component tests (jsdom environment)
    {
      displayName: 'components',
      preset: 'ts-jest',
      testEnvironment: 'jsdom',
      roots: ['<rootDir>/public'],
      testMatch: ['**/__tests__/**/*.test.tsx', '**/__tests__/**/*.test.ts'],
      moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
      transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.test.json', diagnostics: false }],
      },
      moduleNameMapper: {
        // Mock OSD core imports that aren't available outside the OSD tree
        '^opensearch-dashboards/public$': '<rootDir>/public/__mocks__/osd_core.ts',
        '^.*/src/plugins/navigation/public$': '<rootDir>/public/__mocks__/osd_navigation.ts',
        // Mock EUI / OUI components
        '^@elastic/eui$': '<rootDir>/public/__mocks__/eui_mock.tsx',
        '^@opensearch-project/oui$': '<rootDir>/public/__mocks__/eui_mock.tsx',
        // Mock moment (provided by OSD at runtime)
        '^moment$': '<rootDir>/public/__mocks__/style_mock.ts',
        // Mock style imports
        '\\.(css|scss)$': '<rootDir>/public/__mocks__/style_mock.ts',
        // Mock echarts (uses canvas, not available in jsdom)
        '^echarts$': '<rootDir>/public/__mocks__/style_mock.ts',
      },
    },
  ],
  collectCoverageFrom: [
    'common/**/*.ts',
    'server/**/*.ts',
    'public/**/*.{ts,tsx}',
    // Exclude test utilities and mock data — no value in unit testing these
    '!common/mock_backend.ts',
    '!common/mock_enrichment.ts',
    '!common/testing.ts',
    // Exclude integration-only modules — need real backend
    '!common/directquery_prometheus_backend.ts',
    '!common/opensearch_backend.ts',
    // Exclude OSD plugin shell — depends on OSD core
    '!public/plugin.ts',
    '!public/application.tsx',
    '!public/types.ts',
    '!public/components/app.tsx',
    '!server/plugin.ts',
    // Exclude render-heavy UI orchestrators (validated via Cypress E2E, not unit tests).
    // These 1000+ line components have 50%+ of their code as deeply-nested JSX
    // render logic that can only be exercised in a real browser (Cypress E2E).
    '!public/components/alarms_page.tsx',
    '!public/components/alerts_dashboard.tsx',
    '!public/components/monitors_table.tsx',
    '!public/components/slo_listing.tsx',
    '!public/components/create_slo_wizard.tsx',
    '!public/components/create_monitor.tsx',
    '!public/components/create_logs_monitor.tsx',
    '!public/components/create_metrics_monitor.tsx',
    '!public/components/ai_monitor_wizard.tsx',
    '!public/components/alert_detail_flyout.tsx',
    '!public/components/monitor_detail_flyout.tsx',
    '!public/components/notification_routing_panel.tsx',
    '!public/components/suppression_rules_panel.tsx',
    '!public/components/metric_browser.tsx',
    '!public/components/promql_editor.tsx',
    '!public/components/echarts_render.tsx',
    '!public/components/table_pagination.tsx',
    '!public/components/sli_section.tsx',
    '!public/components/sli_combo_boxes.tsx',
    '!public/components/slo_template_selector.tsx',
    '!public/components/alerts_charts.tsx',
    '!public/components/alerts_summary_cards.tsx',
    '!public/components/slo_charts.tsx',
    '!public/components/slo_summary_cards.tsx',
    '!public/components/error_boundary.tsx',
    '!public/components/facet_filter_panel.tsx',
    '!public/components/monitor_form_components.tsx',
    '!public/hooks/use_prometheus_metadata.ts',
    // Exclude mock data — no value in unit testing these
    '!common/mock_data.ts',
    '!**/index.ts',
    '!**/__tests__/**',
    '!**/__mocks__/**',
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },
};
