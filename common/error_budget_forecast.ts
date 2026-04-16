/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SLO Impact Forecasting (Phase 6.3).
 *
 * Pure functions that predict error budget exhaustion from current burn rate.
 * No I/O — operates on SloLiveStatus + SloDefinition already fetched by the UI.
 */

import type { SloLiveStatus, SloDefinition } from './slo_types';
import type { ErrorBudgetForecast, ForecastSeverity } from './root_cause_types';
import { parseDurationToMs } from './slo_promql_generator';

// ============================================================================
// Constants
// ============================================================================

/** Threshold: exhaustion < 2h → critical. */
const CRITICAL_THRESHOLD_MS = 2 * 60 * 60 * 1000;

/** Threshold: exhaustion < 24h → warning. */
const WARNING_THRESHOLD_MS = 24 * 60 * 60 * 1000;

// ============================================================================
// Main forecast function
// ============================================================================

/**
 * Forecast error budget exhaustion from current SLO status.
 *
 * The burn rate multiplier is computed as:
 *   consumedBudgetFraction / elapsedWindowFraction
 *
 * Where consumedBudgetFraction = 1 - errorBudgetRemaining
 * and elapsedWindowFraction is derived from (1 - attainment) / (1 - target).
 *
 * A burn rate of 1.0 means the budget is being consumed at exactly the
 * sustainable rate (it would exhaust at the end of the window).
 * A burn rate of 14.4x means it will exhaust in 1/14.4 of the window.
 */
export function forecastErrorBudgetExhaustion(
  status: SloLiveStatus,
  slo: SloDefinition
): ErrorBudgetForecast {
  const base: Omit<
    ErrorBudgetForecast,
    'exhaustionTime' | 'burnRateMultiplier' | 'timeRemaining' | 'severity' | 'alreadyExhausted'
  > = {
    sloId: status.sloId,
  };

  // No data — cannot forecast
  if (status.status === 'no_data') {
    return {
      ...base,
      exhaustionTime: null,
      burnRateMultiplier: 0,
      timeRemaining: null,
      severity: 'unknown',
      alreadyExhausted: false,
    };
  }

  // Already exhausted
  if (status.errorBudgetRemaining <= 0) {
    return {
      ...base,
      exhaustionTime: null,
      burnRateMultiplier: Infinity,
      timeRemaining: null,
      severity: 'critical',
      alreadyExhausted: true,
    };
  }

  const windowMs = parseDurationToMs(slo.window.duration);
  if (windowMs <= 0) {
    return {
      ...base,
      exhaustionTime: null,
      burnRateMultiplier: 0,
      timeRemaining: null,
      severity: 'unknown',
      alreadyExhausted: false,
    };
  }

  // Error budget total fraction = 1 - target (e.g., 0.001 for 99.9% SLO)
  const errorBudgetTotal = 1 - slo.target;
  if (errorBudgetTotal <= 0) {
    return {
      ...base,
      exhaustionTime: null,
      burnRateMultiplier: 0,
      timeRemaining: null,
      severity: 'unknown',
      alreadyExhausted: false,
    };
  }

  // Consumed fraction of the error budget (0 = nothing consumed, 1 = fully consumed)
  const consumedFraction = 1 - status.errorBudgetRemaining;

  // Burn rate = how fast we're consuming relative to the sustainable rate.
  // If we consumed 50% of the budget in 50% of the window → burn rate 1.0.
  // We derive this from attainment: current error rate / allowed error rate.
  // error rate = (1 - attainment), allowed = (1 - target)
  const currentErrorRate = 1 - status.attainment;
  const burnRateMultiplier = currentErrorRate / errorBudgetTotal;

  // Not burning (burn rate ≤ 1.0 means sustainable or better)
  if (burnRateMultiplier <= 1.0) {
    return {
      ...base,
      exhaustionTime: null,
      burnRateMultiplier: Math.max(0, burnRateMultiplier),
      timeRemaining: null,
      severity: 'ok',
      alreadyExhausted: false,
    };
  }

  // Time to exhaustion: remaining budget / current consumption rate
  // Remaining budget as window-time: errorBudgetRemaining * windowMs
  // Current consumption rate: burnRateMultiplier * (1 window per windowMs)
  const timeToExhaustionMs = (status.errorBudgetRemaining * windowMs) / burnRateMultiplier;

  const severity = forecastSeverityFromTime(timeToExhaustionMs);
  const exhaustionTime = new Date(Date.now() + timeToExhaustionMs);

  return {
    ...base,
    exhaustionTime,
    burnRateMultiplier,
    timeRemaining: formatTimeRemaining(timeToExhaustionMs),
    severity,
    alreadyExhausted: false,
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Determine forecast severity from time to exhaustion.
 */
export function forecastSeverityFromTime(ms: number | null): ForecastSeverity {
  if (ms === null) return 'unknown';
  if (ms <= 0) return 'critical';
  if (ms < CRITICAL_THRESHOLD_MS) return 'critical';
  if (ms < WARNING_THRESHOLD_MS) return 'warning';
  return 'ok';
}

/**
 * Format milliseconds to a human-readable duration string.
 * Examples: "2h 30m", "3d 4h", "45m", "< 1m"
 */
export function formatTimeRemaining(ms: number): string {
  if (ms <= 0) return '< 1m';

  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return '< 1m';

  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 && days === 0) parts.push(`${minutes}m`);

  return parts.join(' ') || '< 1m';
}
