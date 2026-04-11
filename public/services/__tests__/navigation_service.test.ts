/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { NavigationService, AppNavigator } from '../navigation_service';

describe('NavigationService', () => {
  let mockNavigator: AppNavigator;

  beforeEach(() => {
    mockNavigator = {
      navigateToApp: jest.fn().mockResolvedValue(undefined),
    };
  });

  describe('OSD mode with navigator', () => {
    it('navigates to APM service details', () => {
      const svc = new NavigationService(mockNavigator, 'osd');
      svc.navigateToApmService('payment-service');
      expect(mockNavigator.navigateToApp).toHaveBeenCalledWith('observability-traces', {
        path: '#/services/payment-service',
      });
    });

    it('navigates to APM service with time range', () => {
      const svc = new NavigationService(mockNavigator, 'osd');
      svc.navigateToApmService('api-gateway', {
        from: '2024-01-01T00:00:00Z',
        to: '2024-01-01T01:00:00Z',
      });
      const call = (mockNavigator.navigateToApp as jest.Mock).mock.calls[0];
      expect(call[0]).toBe('observability-traces');
      expect(call[1].path).toContain('#/services/api-gateway?');
      expect(call[1].path).toContain('from=');
    });

    it('navigates to trace explorer', () => {
      const svc = new NavigationService(mockNavigator, 'osd');
      svc.navigateToTrace('trace-abc-123');
      expect(mockNavigator.navigateToApp).toHaveBeenCalledWith('observability-traces', {
        path: '#/traces/trace-abc-123',
      });
    });

    it('navigates to log explorer', () => {
      const svc = new NavigationService(mockNavigator, 'osd');
      svc.navigateToLogs('payment-service');
      const call = (mockNavigator.navigateToApp as jest.Mock).mock.calls[0];
      expect(call[0]).toBe('observability-logs');
      expect(call[1].path).toContain('#/explorer?');
      expect(call[1].path).toContain('query=');
    });

    it('navigates to APM service from alert', () => {
      const svc = new NavigationService(mockNavigator, 'osd');
      svc.navigateToApmServiceFromAlert(
        'order-service',
        '2024-06-15T10:00:00Z',
        '2024-06-15T10:30:00Z'
      );
      const call = (mockNavigator.navigateToApp as jest.Mock).mock.calls[0];
      expect(call[0]).toBe('observability-traces');
      expect(call[1].path).toContain('#/services/order-service?');
    });

    it('reports isAvailable as true', () => {
      const svc = new NavigationService(mockNavigator, 'osd');
      expect(svc.isAvailable).toBe(true);
    });
  });

  describe('standalone mode', () => {
    let windowOpenSpy: jest.SpyInstance;

    beforeEach(() => {
      windowOpenSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
    });

    afterEach(() => {
      windowOpenSpy.mockRestore();
    });

    it('opens URL in new tab for trace navigation', () => {
      const svc = new NavigationService(undefined, 'standalone');
      svc.navigateToTrace('trace-xyz');
      expect(windowOpenSpy).toHaveBeenCalledWith(
        '/app/observability-traces#/traces/trace-xyz',
        '_blank'
      );
    });

    it('opens URL in new tab for APM service', () => {
      const svc = new NavigationService(undefined, 'standalone');
      svc.navigateToApmService('my-service');
      expect(windowOpenSpy).toHaveBeenCalledWith(
        expect.stringContaining('/app/observability-traces#/services/my-service'),
        '_blank'
      );
    });

    it('reports isAvailable as false', () => {
      const svc = new NavigationService(undefined, 'standalone');
      expect(svc.isAvailable).toBe(false);
    });
  });

  describe('OSD mode without navigator', () => {
    it('reports isAvailable as false', () => {
      const svc = new NavigationService(undefined, 'osd');
      expect(svc.isAvailable).toBe(false);
    });
  });
});
