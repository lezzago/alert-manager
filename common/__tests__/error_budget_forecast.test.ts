/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  forecastErrorBudgetExhaustion,
  formatTimeRemaining,
  forecastSeverityFromTime,
} from '../error_budget_forecast';
import type { SloLiveStatus, SloDefinition } from '../slo_types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStatus(overrides: Partial<SloLiveStatus> = {}): SloLiveStatus {
  return {
    sloId: 'slo-1',
    currentValue: 0.9995,
    attainment: 0.9995,
    errorBudgetRemaining: 0.5,
    status: 'ok',
    ruleCount: 4,
    firingCount: 0,
    computedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeSlo(overrides: Partial<SloDefinition> = {}): SloDefinition {
  return {
    id: 'slo-1',
    datasourceId: 'ds-1',
    name: 'Test SLO',
    sli: {
      type: 'availability',
      calcMethod: 'good_requests',
      sourceType: 'service_operation',
      metric: 'http_requests_total',
      service: { labelName: 'service', labelValue: 'api' },
      operation: { labelName: 'handler', labelValue: '/health' },
    },
    target: 0.999, // 99.9%
    budgetWarningThreshold: 0.3,
    window: { type: 'rolling', duration: '30d' },
    burnRates: [],
    alarms: { budgetBurn: true, breachWarning: true },
    exclusionWindows: [],
    tags: {},
    ruleGroupName: 'slo-slo-1',
    rulerNamespace: 'slo',
    generatedRuleNames: [],
    version: 1,
    createdAt: new Date().toISOString(),
    createdBy: 'test',
    updatedAt: new Date().toISOString(),
    updatedBy: 'test',
    ...overrides,
  } as SloDefinition;
}

// ---------------------------------------------------------------------------
// forecastErrorBudgetExhaustion
// ---------------------------------------------------------------------------

describe('forecastErrorBudgetExhaustion', () => {
  it('returns unknown severity when status is no_data', () => {
    const status = makeStatus({ status: 'no_data' });
    const slo = makeSlo();
    const forecast = forecastErrorBudgetExhaustion(status, slo);
    expect(forecast.severity).toBe('unknown');
    expect(forecast.exhaustionTime).toBeNull();
    expect(forecast.timeRemaining).toBeNull();
    expect(forecast.alreadyExhausted).toBe(false);
  });

  it('returns alreadyExhausted when errorBudgetRemaining <= 0', () => {
    const status = makeStatus({ errorBudgetRemaining: -0.018, status: 'breached' });
    const slo = makeSlo();
    const forecast = forecastErrorBudgetExhaustion(status, slo);
    expect(forecast.alreadyExhausted).toBe(true);
    expect(forecast.severity).toBe('critical');
    expect(forecast.burnRateMultiplier).toBe(Infinity);
  });

  it('returns ok severity when burn rate <= 1.0 (sustainable)', () => {
    // attainment = 0.9995, target = 0.999 → error rate = 0.0005, allowed = 0.001 → burn = 0.5
    const status = makeStatus({ attainment: 0.9995, errorBudgetRemaining: 0.5 });
    const slo = makeSlo({ target: 0.999 });
    const forecast = forecastErrorBudgetExhaustion(status, slo);
    expect(forecast.severity).toBe('ok');
    expect(forecast.burnRateMultiplier).toBeCloseTo(0.5);
    expect(forecast.exhaustionTime).toBeNull();
  });

  it('computes exhaustion for 14.4x burn rate', () => {
    // target = 0.999, error budget = 0.001
    // attainment = 0.9856 → error rate = 0.0144 → burn rate = 0.0144/0.001 = 14.4
    // window = 30d, remaining budget = 0.1
    // time = 0.1 * 30d / 14.4 ≈ 0.208 days ≈ 5 hours → warning
    const status = makeStatus({ attainment: 0.9856, errorBudgetRemaining: 0.1 });
    const slo = makeSlo({ target: 0.999, window: { type: 'rolling', duration: '30d' } });
    const forecast = forecastErrorBudgetExhaustion(status, slo);
    expect(forecast.burnRateMultiplier).toBeCloseTo(14.4, 0);
    expect(forecast.exhaustionTime).not.toBeNull();
    expect(forecast.severity).toBe('warning');
    expect(forecast.alreadyExhausted).toBe(false);
  });

  it('returns critical when exhaustion is < 2 hours', () => {
    // target = 0.999, burn rate = 14.4, window = 1d, remaining = 0.05
    // time = 0.05 * 86400000 / 14.4 = 300000 ms = 5 min → critical
    const status = makeStatus({ attainment: 0.9856, errorBudgetRemaining: 0.05 });
    const slo = makeSlo({ target: 0.999, window: { type: 'rolling', duration: '1d' } });
    const forecast = forecastErrorBudgetExhaustion(status, slo);
    expect(forecast.severity).toBe('critical');
    expect(forecast.timeRemaining).toBeTruthy();
  });

  it('computes warning for moderate burn rate with remaining budget', () => {
    // target = 0.999, attainment = 0.994 → error rate = 0.006 → burn = 6x
    // window = 7d, remaining = 0.3 → time = 0.3 * 7d / 6 = 0.35d ≈ 8.4h → warning
    const status = makeStatus({ attainment: 0.994, errorBudgetRemaining: 0.3 });
    const slo = makeSlo({ target: 0.999, window: { type: 'rolling', duration: '7d' } });
    const forecast = forecastErrorBudgetExhaustion(status, slo);
    expect(forecast.burnRateMultiplier).toBeCloseTo(6, 0);
    expect(forecast.severity).toBe('warning');
  });

  it('handles zero error budget total gracefully (target = 1.0)', () => {
    const status = makeStatus();
    const slo = makeSlo({ target: 1.0 });
    const forecast = forecastErrorBudgetExhaustion(status, slo);
    expect(forecast.severity).toBe('unknown');
  });

  it('includes a human-readable timeRemaining string', () => {
    // burn rate ~3x, window 30d, remaining 0.5 → ~5 days
    const status = makeStatus({ attainment: 0.997, errorBudgetRemaining: 0.5 });
    const slo = makeSlo({ target: 0.999, window: { type: 'rolling', duration: '30d' } });
    const forecast = forecastErrorBudgetExhaustion(status, slo);
    expect(forecast.timeRemaining).toMatch(/\d+[dhm]/);
  });
});

// ---------------------------------------------------------------------------
// formatTimeRemaining
// ---------------------------------------------------------------------------

describe('formatTimeRemaining', () => {
  it('formats minutes only', () => {
    expect(formatTimeRemaining(45 * 60_000)).toBe('45m');
  });

  it('formats hours and minutes', () => {
    expect(formatTimeRemaining(2.5 * 60 * 60_000)).toBe('2h 30m');
  });

  it('formats days and hours', () => {
    expect(formatTimeRemaining((3 * 24 + 4) * 60 * 60_000)).toBe('3d 4h');
  });

  it('returns "< 1m" for zero or negative', () => {
    expect(formatTimeRemaining(0)).toBe('< 1m');
    expect(formatTimeRemaining(-1000)).toBe('< 1m');
  });

  it('omits minutes when days are present', () => {
    // 2d 3h 15m → shows "2d 3h" (minutes omitted for readability)
    const ms = (2 * 24 * 60 + 3 * 60 + 15) * 60_000;
    expect(formatTimeRemaining(ms)).toBe('2d 3h');
  });
});

// ---------------------------------------------------------------------------
// forecastSeverityFromTime
// ---------------------------------------------------------------------------

describe('forecastSeverityFromTime', () => {
  it('returns unknown for null', () => {
    expect(forecastSeverityFromTime(null)).toBe('unknown');
  });

  it('returns critical for < 2 hours', () => {
    expect(forecastSeverityFromTime(60 * 60_000)).toBe('critical'); // 1h
  });

  it('returns critical for zero', () => {
    expect(forecastSeverityFromTime(0)).toBe('critical');
  });

  it('returns warning for 2h–24h', () => {
    expect(forecastSeverityFromTime(12 * 60 * 60_000)).toBe('warning'); // 12h
  });

  it('returns ok for > 24 hours', () => {
    expect(forecastSeverityFromTime(48 * 60 * 60_000)).toBe('ok'); // 48h
  });
});
