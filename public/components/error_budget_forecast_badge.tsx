/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Error Budget Forecast Badge (Phase 6.3).
 *
 * Inline badge showing time until error budget exhaustion.
 * Pure client-side — calls forecastErrorBudgetExhaustion() with existing data.
 */

import React, { useMemo } from 'react';
import { EuiBadge, EuiToolTip } from '@elastic/eui';
import type { SloLiveStatus, SloDefinition } from '../../common/slo_types';
import { forecastErrorBudgetExhaustion } from '../../common/error_budget_forecast';
import type { ForecastSeverity } from '../../common/root_cause_types';

interface ErrorBudgetForecastBadgeProps {
  status: SloLiveStatus;
  slo: SloDefinition;
}

const SEVERITY_COLORS: Record<ForecastSeverity, string> = {
  critical: 'danger',
  warning: 'warning',
  ok: 'secondary',
  unknown: 'hollow',
};

export const ErrorBudgetForecastBadge: React.FC<ErrorBudgetForecastBadgeProps> = ({
  status,
  slo,
}) => {
  const forecast = useMemo(() => forecastErrorBudgetExhaustion(status, slo), [status, slo]);

  if (forecast.severity === 'unknown') return null;

  let label: string;
  let tooltip: string;

  if (forecast.alreadyExhausted) {
    label = 'Budget exhausted';
    tooltip = 'Error budget is fully consumed. SLO is breached.';
  } else if (forecast.timeRemaining) {
    label = `Exhausts in ~${forecast.timeRemaining}`;
    tooltip = `At current burn rate (${forecast.burnRateMultiplier.toFixed(1)}x), error budget will be exhausted in approximately ${forecast.timeRemaining}.`;
  } else {
    label = 'Budget healthy';
    tooltip = `Burn rate: ${forecast.burnRateMultiplier.toFixed(1)}x (sustainable ≤ 1.0x)`;
  }

  return (
    <EuiToolTip content={tooltip}>
      <EuiBadge color={SEVERITY_COLORS[forecast.severity]} data-test-subj="forecast-badge">
        {label}
      </EuiBadge>
    </EuiToolTip>
  );
};
