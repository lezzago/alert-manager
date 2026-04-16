/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { computeCoverageGaps, computeGapSeverity } from '../coverage_gap_service';
import type { EnrichedOtelService } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeService(overrides: Partial<EnrichedOtelService> = {}): EnrichedOtelService {
  return {
    name: 'test-service',
    environment: 'production',
    type: 'Service',
    sdkLanguage: 'java',
    dependencies: [],
    lastSeen: new Date().toISOString(),
    sloCount: 0,
    activeAlertCount: 0,
    signals: { hasTraces: true, hasLogs: true, hasMetrics: true },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// computeGapSeverity
// ---------------------------------------------------------------------------

describe('computeGapSeverity', () => {
  it('returns high when service has signals but no SLOs and no alerts', () => {
    expect(computeGapSeverity(false, false, true, 3, 0)).toBe('high');
  });

  it('returns medium when service has alerts but no SLOs', () => {
    expect(computeGapSeverity(false, true, true, 0, 0)).toBe('medium');
  });

  it('returns medium when service has SLOs but uncovered signals', () => {
    expect(computeGapSeverity(true, false, true, 2, 0)).toBe('medium');
  });

  it('returns low when only uncovered dependencies exist', () => {
    expect(computeGapSeverity(true, false, true, 0, 2)).toBe('low');
  });

  it('returns low for services with no signals and no coverage (database stubs)', () => {
    expect(computeGapSeverity(false, false, false, 0, 0)).toBe('low');
  });

  it('returns none when fully covered', () => {
    expect(computeGapSeverity(true, true, true, 0, 0)).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// computeCoverageGaps
// ---------------------------------------------------------------------------

describe('computeCoverageGaps', () => {
  it('returns empty report for empty services', () => {
    const report = computeCoverageGaps([]);
    expect(report.totalServices).toBe(0);
    expect(report.gaps).toHaveLength(0);
    expect(report.sloCoveragePercent).toBe(0);
  });

  it('identifies services without SLOs as gaps', () => {
    const services = [
      makeService({ name: 'api-gateway', sloCount: 2, activeAlertCount: 1 }),
      makeService({ name: 'payment-service', sloCount: 0, activeAlertCount: 0 }),
    ];
    const report = computeCoverageGaps(services);
    expect(report.servicesWithSlos).toBe(1);
    expect(report.servicesWithoutAnyCoverage).toBe(1);
    const paymentGap = report.gaps.find((g) => g.serviceName === 'payment-service');
    expect(paymentGap?.gapSeverity).toBe('high');
  });

  it('computes sloCoveragePercent and alertCoveragePercent', () => {
    const services = [
      makeService({ name: 'svc-a', sloCount: 1, activeAlertCount: 1 }),
      makeService({ name: 'svc-b', sloCount: 1, activeAlertCount: 0 }),
      makeService({ name: 'svc-c', sloCount: 0, activeAlertCount: 0 }),
      makeService({ name: 'svc-d', sloCount: 0, activeAlertCount: 1 }),
    ];
    const report = computeCoverageGaps(services);
    expect(report.sloCoveragePercent).toBe(50); // 2 of 4
    expect(report.alertCoveragePercent).toBe(50); // 2 of 4
  });

  it('identifies uncovered dependencies', () => {
    const services = [
      makeService({
        name: 'checkout',
        sloCount: 1,
        dependencies: ['payment-db', 'api-gateway'],
      }),
      makeService({ name: 'api-gateway', sloCount: 1 }),
      // payment-db has no SLOs and is in the service list
      makeService({
        name: 'payment-db',
        sloCount: 0,
        signals: { hasTraces: false, hasLogs: false, hasMetrics: false },
      }),
    ];
    const report = computeCoverageGaps(services);
    const checkoutGap = report.gaps.find((g) => g.serviceName === 'checkout');
    expect(checkoutGap?.uncoveredDependencies).toContain('payment-db');
    expect(checkoutGap?.uncoveredDependencies).not.toContain('api-gateway');
  });

  it('lists uncovered signals when no SLOs', () => {
    const svc = makeService({
      name: 'logging-svc',
      sloCount: 0,
      signals: { hasTraces: true, hasLogs: true, hasMetrics: false },
    });
    const report = computeCoverageGaps([svc]);
    const gap = report.gaps[0];
    expect(gap.uncoveredSignals).toContain('traces');
    expect(gap.uncoveredSignals).toContain('logs');
    expect(gap.uncoveredSignals).not.toContain('metrics');
  });

  it('sorts gaps by severity descending (high first)', () => {
    const services = [
      makeService({ name: 'fully-covered', sloCount: 2, activeAlertCount: 1 }),
      makeService({ name: 'no-coverage', sloCount: 0, activeAlertCount: 0 }),
      makeService({
        name: 'partial',
        sloCount: 1,
        activeAlertCount: 0,
        dependencies: ['no-coverage'],
      }),
    ];
    const report = computeCoverageGaps(services);
    expect(report.gaps[0].serviceName).toBe('no-coverage');
    expect(report.gaps[0].gapSeverity).toBe('high');
  });

  it('marks fully covered services with gapSeverity none', () => {
    const svc = makeService({ name: 'healthy', sloCount: 3, activeAlertCount: 1 });
    const report = computeCoverageGaps([svc]);
    expect(report.gaps[0].gapSeverity).toBe('none');
  });

  it('includes computedAt timestamp', () => {
    const report = computeCoverageGaps([makeService()]);
    expect(report.computedAt).toBeTruthy();
    expect(new Date(report.computedAt).getTime()).toBeGreaterThan(0);
  });
});
