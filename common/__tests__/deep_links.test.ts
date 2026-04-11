/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  buildHash,
  parseHash,
  buildApmServiceUrl,
  buildTraceExplorerUrl,
  buildLogExplorerUrl,
  buildAlertManagerUrl,
  buildAlertTimeRange,
  HashRoute,
} from '../deep_links';

describe('deep_links', () => {
  // ==========================================================================
  // buildHash
  // ==========================================================================
  describe('buildHash', () => {
    it('builds hash for a simple tab', () => {
      expect(buildHash({ tab: 'alerts' })).toBe('#/alerts');
      expect(buildHash({ tab: 'rules' })).toBe('#/rules');
      expect(buildHash({ tab: 'routing' })).toBe('#/routing');
      expect(buildHash({ tab: 'suppression' })).toBe('#/suppression');
      expect(buildHash({ tab: 'slos' })).toBe('#/slos');
      expect(buildHash({ tab: 'services' })).toBe('#/services');
    });

    it('builds hash for alert detail', () => {
      expect(
        buildHash({
          tab: 'alerts',
          alertDetail: { datasourceId: 'ds-1', alertId: 'alert-123' },
        })
      ).toBe('#/alerts/ds-1/alert-123');
    });

    it('encodes special characters in alert detail', () => {
      expect(
        buildHash({
          tab: 'alerts',
          alertDetail: { datasourceId: 'ds/1', alertId: 'alert 123' },
        })
      ).toBe('#/alerts/ds%2F1/alert%20123');
    });

    it('builds hash for SLO detail', () => {
      expect(buildHash({ tab: 'slos', sloId: 'slo-abc' })).toBe('#/slos/slo-abc');
    });

    it('builds hash for service detail', () => {
      expect(buildHash({ tab: 'services', serviceName: 'api-gateway' })).toBe(
        '#/services/api-gateway'
      );
    });

    it('encodes special characters in service name', () => {
      expect(buildHash({ tab: 'services', serviceName: 'my service/v2' })).toBe(
        '#/services/my%20service%2Fv2'
      );
    });

    it('ignores alertDetail when tab is not alerts', () => {
      expect(
        buildHash({
          tab: 'slos',
          alertDetail: { datasourceId: 'ds-1', alertId: 'alert-1' },
        })
      ).toBe('#/slos');
    });
  });

  // ==========================================================================
  // parseHash
  // ==========================================================================
  describe('parseHash', () => {
    it('parses empty hash as alerts tab', () => {
      expect(parseHash('')).toEqual({ tab: 'alerts' });
      expect(parseHash('#')).toEqual({ tab: 'alerts' });
      expect(parseHash('#/')).toEqual({ tab: 'alerts' });
    });

    it('parses simple tab hashes', () => {
      expect(parseHash('#/alerts')).toEqual({ tab: 'alerts' });
      expect(parseHash('#/rules')).toEqual({ tab: 'rules' });
      expect(parseHash('#/routing')).toEqual({ tab: 'routing' });
      expect(parseHash('#/suppression')).toEqual({ tab: 'suppression' });
      expect(parseHash('#/slos')).toEqual({ tab: 'slos' });
      expect(parseHash('#/services')).toEqual({ tab: 'services' });
    });

    it('parses alert detail hash', () => {
      expect(parseHash('#/alerts/ds-1/alert-123')).toEqual({
        tab: 'alerts',
        alertDetail: { datasourceId: 'ds-1', alertId: 'alert-123' },
      });
    });

    it('decodes URL-encoded segments', () => {
      expect(parseHash('#/alerts/ds%2F1/alert%20123')).toEqual({
        tab: 'alerts',
        alertDetail: { datasourceId: 'ds/1', alertId: 'alert 123' },
      });
    });

    it('parses SLO detail hash', () => {
      expect(parseHash('#/slos/slo-abc')).toEqual({
        tab: 'slos',
        sloId: 'slo-abc',
      });
    });

    it('parses service detail hash', () => {
      expect(parseHash('#/services/api-gateway')).toEqual({
        tab: 'services',
        serviceName: 'api-gateway',
      });
    });

    it('returns alerts tab for invalid tab names', () => {
      expect(parseHash('#/unknown')).toEqual({ tab: 'alerts' });
      expect(parseHash('#/foo/bar')).toEqual({ tab: 'alerts' });
    });

    it('roundtrips through buildHash and parseHash', () => {
      const routes: HashRoute[] = [
        { tab: 'alerts' },
        { tab: 'alerts', alertDetail: { datasourceId: 'ds-2', alertId: 'a-1' } },
        { tab: 'slos', sloId: 'slo-123' },
        { tab: 'services', serviceName: 'payment-service' },
        { tab: 'rules' },
      ];
      for (const route of routes) {
        expect(parseHash(buildHash(route))).toEqual(route);
      }
    });
  });

  // ==========================================================================
  // External app URLs
  // ==========================================================================
  describe('buildApmServiceUrl', () => {
    it('builds basic service URL', () => {
      expect(buildApmServiceUrl('api-gateway')).toBe('#/services/api-gateway');
    });

    it('builds service URL with time range', () => {
      const url = buildApmServiceUrl('api-gateway', {
        from: '2024-01-01T00:00:00Z',
        to: '2024-01-01T01:00:00Z',
      });
      expect(url).toContain('#/services/api-gateway?');
      expect(url).toContain('from=2024-01-01T00%3A00%3A00Z');
      expect(url).toContain('to=2024-01-01T01%3A00%3A00Z');
    });
  });

  describe('buildTraceExplorerUrl', () => {
    it('builds trace URL', () => {
      expect(buildTraceExplorerUrl('abc123')).toBe('#/traces/abc123');
    });
  });

  describe('buildLogExplorerUrl', () => {
    it('builds log URL with default query', () => {
      const url = buildLogExplorerUrl('payment-service');
      expect(url).toContain('#/explorer?');
      expect(url).toContain('query=serviceName');
      expect(url).toContain('payment-service');
    });

    it('builds log URL with custom query', () => {
      const url = buildLogExplorerUrl('svc', undefined, 'error AND timeout');
      expect(url).toContain('query=error+AND+timeout');
    });
  });

  describe('buildAlertManagerUrl', () => {
    it('strips the leading hash for navigateToApp path', () => {
      expect(buildAlertManagerUrl({ tab: 'alerts' })).toBe('/alerts');
      expect(buildAlertManagerUrl({ tab: 'services', serviceName: 'svc' })).toBe('/services/svc');
    });
  });

  describe('buildAlertTimeRange', () => {
    it('expands time range by 15 minutes', () => {
      const start = '2024-06-15T10:00:00Z';
      const end = '2024-06-15T10:30:00Z';
      const range = buildAlertTimeRange(start, end);
      expect(new Date(range.from).getTime()).toBe(new Date(start).getTime() - 15 * 60 * 1000);
      expect(new Date(range.to).getTime()).toBe(new Date(end).getTime() + 15 * 60 * 1000);
    });

    it('uses current time as end when not provided', () => {
      const start = '2024-06-15T10:00:00Z';
      const before = Date.now();
      const range = buildAlertTimeRange(start);
      const after = Date.now();
      const toTime = new Date(range.to).getTime();
      // to should be approximately now + 15 min
      expect(toTime).toBeGreaterThanOrEqual(before + 15 * 60 * 1000 - 100);
      expect(toTime).toBeLessThanOrEqual(after + 15 * 60 * 1000 + 100);
    });
  });
});
