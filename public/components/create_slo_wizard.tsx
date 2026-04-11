/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Create SLO Wizard — 5-section accordion form for defining Service Level Objectives.
 * Generates Prometheus recording + alerting rules following the MWMBR pattern.
 *
 * Uses the same generateSloRuleGroup() function client-side (for preview)
 * and server-side (for deployment) to ensure no divergence.
 *
 * SLI form state is managed by `useReducer` in the extracted `SliSection`.
 */
import React, { useState, useMemo, useCallback, useReducer, useEffect } from 'react';
import {
  EuiSpacer,
  EuiPanel,
  EuiFlexGroup,
  EuiFlexItem,
  EuiFormRow,
  EuiFieldText,
  EuiFieldNumber,
  EuiSelect,
  EuiButton,
  EuiButtonEmpty,
  EuiButtonIcon,
  EuiText,
  EuiAccordion,
  EuiCallOut,
  EuiFlyout,
  EuiFlyoutHeader,
  EuiFlyoutBody,
  EuiFlyoutFooter,
  EuiTitle,
  EuiCheckbox,
  EuiIcon,
  EuiBadge,
} from '@elastic/eui';
import type {
  SloInput,
  BurnRateConfig,
  SloAlarmConfig,
  ExclusionWindow,
} from '../../common/slo_types';
import { DEFAULT_MWMBR_TIERS } from '../../common/slo_types';
import { validateSloFormFull } from '../../common/slo_validators';
import { formatErrorBudget } from '../../common/slo_templates';
import { parseDurationToMs } from '../../common/slo_promql_generator';
import type { AlarmsApiClient } from '../services/alarms_client';
import { SliSection, sliFormReducer, initialSliState } from './sli_section';
import { SloPreviewPanel } from './slo_preview_panel';

// ============================================================================
// Types
// ============================================================================

interface CreateSloWizardProps {
  datasourceId: string;
  onClose: () => void;
  onCreated: () => void;
  apiClient: Pick<
    AlarmsApiClient,
    'createSlo' | 'getMetricNames' | 'getLabelNames' | 'getLabelValues' | 'getMetricMetadata'
  >;
  /** Optional pre-filled SLO input from the suggestion engine. */
  prefill?: SloInput;
}

// ============================================================================
// Constants
// ============================================================================

const WINDOW_DURATION_OPTIONS = [
  { value: '1d', text: '1 day' },
  { value: '3d', text: '3 days' },
  { value: '7d', text: '7 days' },
  { value: '14d', text: '14 days' },
  { value: '30d', text: '30 days' },
];

// ============================================================================
// Sub-components — BurnRateSection remains inline (not extracted in this PR)
// ============================================================================

/** Format burn-rate depletion time in human-readable form. */
function formatDepletionTime(burnRateMultiplier: number, windowDuration: string): string {
  if (burnRateMultiplier <= 0) return '';
  const windowMs = parseDurationToMs(windowDuration);
  const depletionHours = windowMs / (burnRateMultiplier * 3600000);
  if (depletionHours < 1) {
    const minutes = Math.round(depletionHours * 60);
    return `~${minutes}m`;
  }
  if (depletionHours < 48) {
    return `~${depletionHours.toFixed(1).replace(/\.0$/, '')}h`;
  }
  const days = depletionHours / 24;
  return `~${days.toFixed(1).replace(/\.0$/, '')}d`;
}

/* --- Section 4: Burn Rate & Alarms --- */
const BurnRateSection: React.FC<{
  burnRates: BurnRateConfig[];
  alarms: SloAlarmConfig;
  windowDuration: string;
  hasSubmitted: boolean;
  errors: Record<string, string>;
  onBurnRatesChange: (rates: BurnRateConfig[]) => void;
  onAlarmsChange: (alarms: SloAlarmConfig) => void;
}> = ({
  burnRates,
  alarms,
  windowDuration,
  hasSubmitted,
  errors,
  onBurnRatesChange,
  onAlarmsChange,
}) => {
  const addBurnRate = () => {
    onBurnRatesChange([
      ...burnRates,
      {
        shortWindow: '5m',
        longWindow: '1h',
        burnRateMultiplier: 14.4,
        severity: 'critical',
        createAlarm: true,
        forDuration: '2m',
      },
    ]);
  };

  const removeBurnRate = (index: number) => {
    onBurnRatesChange(burnRates.filter((_, i) => i !== index));
  };

  const updateBurnRate = (
    index: number,
    field: keyof BurnRateConfig,
    value: string | number | boolean
  ) => {
    const updated = [...burnRates];
    updated[index] = { ...updated[index], [field]: value };
    onBurnRatesChange(updated);
  };

  const useRecommended = () => {
    onBurnRatesChange([...DEFAULT_MWMBR_TIERS]);
  };

  return (
    <>
      <EuiFlexGroup justifyContent="spaceBetween" alignItems="center">
        <EuiFlexItem grow={false}>
          <EuiText size="s">
            <strong>Burn rate alert tiers</strong>
          </EuiText>
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiButtonEmpty
            size="s"
            onClick={useRecommended}
            iconType="sparkles"
            data-test-subj="alertManager-sloWizard-useRecommended"
          >
            Use recommended defaults
          </EuiButtonEmpty>
        </EuiFlexItem>
      </EuiFlexGroup>
      <EuiSpacer size="s" />
      <EuiCallOut title="How burn rate alerts work" iconType="iInCircle" size="s" color="primary">
        <p>
          Each tier detects error budget consumption at a different speed. A higher rate (e.g.
          14.4x) catches fast-burning incidents in minutes; a lower rate (e.g. 3x) catches slow
          degradation over hours. Both a short and long window must agree before the alert fires,
          which prevents false positives from brief spikes.
        </p>
      </EuiCallOut>
      <EuiSpacer size="m" />

      {burnRates.map((tier, i) => (
        <EuiPanel
          key={`${tier.shortWindow}-${tier.longWindow}-${tier.burnRateMultiplier}`}
          paddingSize="s"
          style={{ marginBottom: 8 }}
        >
          <EuiFlexGroup gutterSize="s" alignItems="center">
            <EuiFlexItem grow={false} style={{ width: 90 }}>
              <EuiFormRow
                label={i === 0 ? 'Short window' : undefined}
                helpText={i === 0 ? 'Fast check' : undefined}
                isInvalid={hasSubmitted && !!errors[`burnRates[${i}].shortWindow`]}
              >
                <EuiFieldText
                  compressed
                  value={tier.shortWindow}
                  onChange={(e) => updateBurnRate(i, 'shortWindow', e.target.value)}
                  data-test-subj={`alertManager-sloWizard-burnRate-${i}-shortWindow`}
                />
              </EuiFormRow>
            </EuiFlexItem>
            <EuiFlexItem grow={false} style={{ width: 90 }}>
              <EuiFormRow
                label={i === 0 ? 'Long window' : undefined}
                helpText={i === 0 ? 'Confirmation' : undefined}
              >
                <EuiFieldText
                  compressed
                  value={tier.longWindow}
                  onChange={(e) => updateBurnRate(i, 'longWindow', e.target.value)}
                  data-test-subj={`alertManager-sloWizard-burnRate-${i}-longWindow`}
                />
              </EuiFormRow>
            </EuiFlexItem>
            <EuiFlexItem grow={false} style={{ width: 80 }}>
              <EuiFormRow
                label={i === 0 ? 'Burn rate' : undefined}
                helpText={i === 0 ? 'Multiplier' : undefined}
              >
                <EuiFieldNumber
                  compressed
                  value={tier.burnRateMultiplier}
                  onChange={(e) =>
                    updateBurnRate(i, 'burnRateMultiplier', parseFloat(e.target.value) || 0)
                  }
                  min={0}
                  step={0.1}
                  data-test-subj={`alertManager-sloWizard-burnRate-${i}-multiplier`}
                />
              </EuiFormRow>
            </EuiFlexItem>
            <EuiFlexItem grow={false} style={{ width: 100 }}>
              <EuiFormRow
                label={i === 0 ? 'Severity' : undefined}
                helpText={i === 0 ? 'Alert level' : undefined}
              >
                <EuiSelect
                  compressed
                  options={[
                    { value: 'critical', text: 'Critical' },
                    { value: 'warning', text: 'Warning' },
                  ]}
                  value={tier.severity}
                  onChange={(e) => updateBurnRate(i, 'severity', e.target.value)}
                  data-test-subj={`alertManager-sloWizard-burnRate-${i}-severity`}
                />
              </EuiFormRow>
            </EuiFlexItem>
            <EuiFlexItem grow={false} style={{ width: 80 }}>
              <EuiFormRow
                label={i === 0 ? 'Pending' : undefined}
                helpText={i === 0 ? 'Wait time' : undefined}
              >
                <EuiFieldText
                  compressed
                  value={tier.forDuration}
                  onChange={(e) => updateBurnRate(i, 'forDuration', e.target.value)}
                  data-test-subj={`alertManager-sloWizard-burnRate-${i}-forDuration`}
                />
              </EuiFormRow>
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              {i === 0 ? <EuiSpacer size="l" /> : null}
              <EuiButtonIcon
                iconType="trash"
                color="danger"
                onClick={() => removeBurnRate(i)}
                aria-label="Remove tier"
                data-test-subj={`alertManager-sloWizard-burnRate-${i}-remove`}
              />
            </EuiFlexItem>
          </EuiFlexGroup>
          {tier.burnRateMultiplier > 0 && (
            <EuiText size="xs" color="subdued" style={{ marginTop: 2, marginLeft: 4 }}>
              Budget depletion: {formatDepletionTime(tier.burnRateMultiplier, windowDuration)} at
              this burn rate
            </EuiText>
          )}
        </EuiPanel>
      ))}

      <EuiButtonEmpty
        size="s"
        onClick={addBurnRate}
        iconType="plusInCircle"
        data-test-subj="alertManager-sloWizard-addBurnRate"
      >
        Add burn rate tier
      </EuiButtonEmpty>

      <EuiSpacer size="l" />
      <EuiText size="s">
        <strong>Additional SLO alarms</strong>
      </EuiText>
      <EuiText size="xs" color="subdued">
        These alarms complement the burn rate tiers above with broader SLO health checks.
      </EuiText>
      <EuiSpacer size="s" />
      <EuiCheckbox
        id="alarm-sli-health"
        label="SLI health alarm"
        checked={alarms.sliHealth.enabled}
        onChange={() =>
          onAlarmsChange({
            ...alarms,
            sliHealth: { ...alarms.sliHealth, enabled: !alarms.sliHealth.enabled },
          })
        }
        data-test-subj="alertManager-sloWizard-alarm-sliHealth"
      />
      <EuiText size="xs" color="subdued" style={{ marginLeft: 24, marginBottom: 8 }}>
        Fires when the instantaneous error ratio exceeds the budget rate over a 5-minute window.
        Good for detecting sudden spikes.
      </EuiText>
      <EuiCheckbox
        id="alarm-attainment"
        label="Attainment breach alarm"
        checked={alarms.attainmentBreach.enabled}
        onChange={() =>
          onAlarmsChange({
            ...alarms,
            attainmentBreach: {
              ...alarms.attainmentBreach,
              enabled: !alarms.attainmentBreach.enabled,
            },
          })
        }
        data-test-subj="alertManager-sloWizard-alarm-attainmentBreach"
      />
      <EuiText size="xs" color="subdued" style={{ marginLeft: 24, marginBottom: 8 }}>
        Fires when cumulative attainment drops below your target (e.g. 99.9%). Indicates the SLO has
        already been breached.
      </EuiText>
      <EuiCheckbox
        id="alarm-budget-warning"
        label="Budget depletion warning"
        checked={alarms.budgetWarning.enabled}
        onChange={() =>
          onAlarmsChange({
            ...alarms,
            budgetWarning: { ...alarms.budgetWarning, enabled: !alarms.budgetWarning.enabled },
          })
        }
        data-test-subj="alertManager-sloWizard-alarm-budgetWarning"
      />
      <EuiText size="xs" color="subdued" style={{ marginLeft: 24 }}>
        Fires when remaining error budget drops below the warning threshold you set in Section 2.
        Gives early notice before a full breach.
      </EuiText>
    </>
  );
};

// ============================================================================
// Section completion helpers
// ============================================================================

/** Map validation error keys to wizard section numbers. */
function getSectionErrors(errors: Record<string, string>): Record<number, boolean> {
  const sections: Record<number, boolean> = { 1: true, 2: true, 3: true, 4: true };
  for (const key of Object.keys(errors)) {
    if (key.startsWith('sli.') || key === 'sli') sections[1] = false;
    else if (key === 'target' || key === 'budgetWarningThreshold') sections[2] = false;
    else if (key === 'name') sections[3] = false;
    else if (key.startsWith('burnRates')) sections[4] = false;
  }
  return sections;
}

/** Accordion button with optional green checkmark when section is valid. */
const SectionButton: React.FC<{
  label: string;
  isComplete: boolean;
  showIndicator: boolean;
}> = ({ label, isComplete, showIndicator }) => (
  <span>
    {label}
    {showIndicator && isComplete && (
      <>
        {' '}
        <EuiIcon
          type="checkInCircleFilled"
          color="success"
          size="s"
          aria-label="Section complete"
        />
      </>
    )}
  </span>
);

// ============================================================================
// Main Component
// ============================================================================

export const CreateSloWizard: React.FC<CreateSloWizardProps> = ({
  datasourceId,
  onClose,
  onCreated,
  apiClient,
  prefill,
}) => {
  // SLI form state — managed by useReducer for atomic template application
  const [sliState, sliDispatch] = useReducer(sliFormReducer, initialSliState);

  // Section 2: SLO target
  const [target, setTarget] = useState('99.9');
  const [budgetWarningThreshold, setBudgetWarningThreshold] = useState('30');
  const [windowDuration, setWindowDuration] = useState('1d');
  const [exclusionWindows] = useState<ExclusionWindow[]>([]);

  // Section 3: Name
  const [sloName, setSloName] = useState('');
  const [autoName, setAutoName] = useState(true);

  // Section 4: Burn rates and alarms
  const [burnRates, setBurnRates] = useState<BurnRateConfig[]>([...DEFAULT_MWMBR_TIERS]);
  const [alarms, setAlarms] = useState<SloAlarmConfig>({
    sliHealth: { enabled: true },
    attainmentBreach: { enabled: true },
    budgetWarning: { enabled: true },
  });

  // Section 5: Tags
  const [tags, setTags] = useState<Array<{ key: string; value: string }>>([]);

  // Apply pre-fill from suggestion engine (one-time on mount)
  useEffect(() => {
    if (!prefill) return;
    // SLI fields
    sliDispatch({ type: 'SET_FIELD', field: 'metric', value: prefill.sli.metric });
    sliDispatch({ type: 'SET_SLI_TYPE', value: prefill.sli.type });
    sliDispatch({ type: 'SET_FIELD', field: 'calcMethod', value: prefill.sli.calcMethod });
    sliDispatch({ type: 'SET_SOURCE_TYPE', value: prefill.sli.sourceType });
    sliDispatch({
      type: 'SET_FIELD',
      field: 'service',
      value: prefill.sli.service.labelValue,
    });
    sliDispatch({
      type: 'SET_FIELD',
      field: 'serviceLabelName',
      value: prefill.sli.service.labelName,
    });
    sliDispatch({
      type: 'SET_FIELD',
      field: 'operation',
      value: prefill.sli.operation.labelValue,
    });
    sliDispatch({
      type: 'SET_FIELD',
      field: 'operationLabelName',
      value: prefill.sli.operation.labelName,
    });
    if (prefill.sli.goodEventsFilter) {
      sliDispatch({
        type: 'SET_FIELD',
        field: 'goodEventsFilter',
        value: prefill.sli.goodEventsFilter,
      });
    }
    if (prefill.sli.latencyThreshold !== undefined) {
      sliDispatch({
        type: 'SET_FIELD',
        field: 'latencyThreshold',
        value: String(prefill.sli.latencyThreshold),
      });
    }
    if (prefill.sli.dependency) {
      sliDispatch({
        type: 'SET_FIELD',
        field: 'dependency',
        value: prefill.sli.dependency.labelValue,
      });
      sliDispatch({
        type: 'SET_FIELD',
        field: 'dependencyLabelName',
        value: prefill.sli.dependency.labelName,
      });
    }
    // SLO-level fields
    setTarget(String(prefill.target * 100));
    setBudgetWarningThreshold(String(prefill.budgetWarningThreshold * 100));
    setWindowDuration(prefill.window.duration);
    if (prefill.burnRates) setBurnRates([...prefill.burnRates]);
    if (prefill.name) {
      setSloName(prefill.name);
      setAutoName(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Submission state
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Auto-generate name from service + operation + SLI type
  const generatedName = useMemo(() => {
    const typeName =
      sliState.sliType === 'availability'
        ? 'Availability'
        : sliState.sliType === 'latency_p99'
          ? 'p99 Latency'
          : sliState.sliType === 'latency_p90'
            ? 'p90 Latency'
            : 'p50 Latency';
    const parts = [sliState.service, sliState.operation, typeName].filter(Boolean);
    return parts.length >= 2 ? parts.join(' — ') : '';
  }, [sliState.service, sliState.operation, sliState.sliType]);

  const effectiveName = autoName ? generatedName : sloName;

  // Error budget display
  const errorBudgetDisplay = useMemo(() => {
    const targetDecimal = parseFloat(target) / 100;
    if (isNaN(targetDecimal) || targetDecimal <= 0 || targetDecimal >= 1) return null;
    try {
      return formatErrorBudget(targetDecimal, windowDuration);
    } catch {
      return null;
    }
  }, [target, windowDuration]);

  // Build the SLO input for validation and preview — derived from reducer state
  const sloInput: Partial<SloInput> = useMemo(() => {
    const tagMap: Record<string, string> = {};
    for (const t of tags) {
      if (t.key.trim()) tagMap[t.key.trim()] = t.value.trim();
    }

    return {
      datasourceId,
      name: effectiveName,
      sli: {
        type: sliState.sliType,
        calcMethod: sliState.calcMethod,
        sourceType: sliState.sourceType,
        metric: sliState.metric.trim(),
        goodEventsFilter:
          sliState.sliType === 'availability' ? sliState.goodEventsFilter : undefined,
        latencyThreshold:
          sliState.sliType !== 'availability'
            ? parseFloat(sliState.latencyThreshold) || undefined
            : undefined,
        service: { labelName: sliState.serviceLabelName, labelValue: sliState.service.trim() },
        operation: {
          labelName: sliState.operationLabelName,
          labelValue: sliState.operation.trim(),
        },
        dependency:
          sliState.sourceType === 'service_dependency'
            ? {
                labelName: sliState.dependencyLabelName,
                labelValue: sliState.dependency.trim(),
              }
            : undefined,
        periodLength: sliState.calcMethod === 'good_periods' ? sliState.periodLength : undefined,
      },
      target: parseFloat(target) / 100, // UI shows %, store as decimal
      budgetWarningThreshold: parseFloat(budgetWarningThreshold) / 100,
      window: { type: 'rolling' as const, duration: windowDuration },
      burnRates,
      alarms,
      exclusionWindows,
      tags: tagMap,
    };
  }, [
    datasourceId,
    effectiveName,
    sliState,
    target,
    budgetWarningThreshold,
    windowDuration,
    burnRates,
    alarms,
    exclusionWindows,
    tags,
  ]);

  // Validation
  const { errors: validationErrors, warnings: validationWarnings } = useMemo(
    () => validateSloFormFull(sloInput as SloInput),
    [sloInput]
  );
  const isFormValid = Object.keys(validationErrors).length === 0;
  const sectionComplete = useMemo(() => getSectionErrors(validationErrors), [validationErrors]);

  // Submit
  const handleSubmit = useCallback(async () => {
    setHasSubmitted(true);
    if (!isFormValid) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      await apiClient.createSlo(sloInput as SloInput);
      onCreated();
      onClose();
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : 'Failed to create SLO');
    }
    setSubmitting(false);
  }, [isFormValid, sloInput, apiClient, onCreated, onClose]);

  // Tags helpers
  const addTag = () => setTags([...tags, { key: '', value: '' }]);
  const removeTag = (i: number) => setTags(tags.filter((_, idx) => idx !== i));
  const updateTag = (i: number, field: 'key' | 'value', val: string) => {
    const updated = [...tags];
    updated[i] = { ...updated[i], [field]: val };
    setTags(updated);
  };

  return (
    <EuiFlyout
      onClose={onClose}
      ownFocus
      size="l"
      aria-labelledby="createSloTitle"
      maxWidth={1100}
      data-test-subj="alertManager-sloWizard"
    >
      <EuiFlyoutHeader hasBorder>
        <EuiTitle size="m">
          <h2 id="createSloTitle">Create Service Level Objective (SLO)</h2>
        </EuiTitle>
        <EuiText size="s" color="subdued">
          An SLO defines how reliable your service should be. Pick a template below, choose your
          service and target, and the system generates Prometheus recording and alerting rules
          automatically. Start with Section 1 and work your way down.
        </EuiText>
      </EuiFlyoutHeader>

      <EuiFlyoutBody>
        <EuiFlexGroup gutterSize="l">
          {/* Left: Form */}
          <EuiFlexItem grow={3}>
            {Object.keys(validationWarnings).length > 0 && (
              <>
                <EuiCallOut title="Validation warnings" color="warning" iconType="help" size="s">
                  {Object.entries(validationWarnings).map(([field, msg]) => (
                    <p key={field}>
                      <strong>{field}:</strong> {msg}
                    </p>
                  ))}
                </EuiCallOut>
                <EuiSpacer size="m" />
              </>
            )}
            {submitError && (
              <>
                <EuiCallOut title="Error creating SLO" color="danger" iconType="alert">
                  <p>{submitError}</p>
                </EuiCallOut>
                <EuiSpacer size="m" />
              </>
            )}

            {/* Section 1: Set SLI */}
            <EuiAccordion
              id="slo-section-sli"
              buttonContent={
                <SectionButton
                  label="Section 1 — Set Service Level Indicator (SLI)"
                  isComplete={sectionComplete[1]}
                  showIndicator={hasSubmitted || sectionComplete[1]}
                />
              }
              initialIsOpen
              paddingSize="m"
              data-test-subj="alertManager-sloWizard-section1"
            >
              <SliSection
                datasourceId={datasourceId}
                apiClient={apiClient}
                sliState={sliState}
                dispatch={sliDispatch}
                hasSubmitted={hasSubmitted}
                errors={validationErrors}
              />
            </EuiAccordion>

            <EuiSpacer size="m" />

            {/* Section 2: Set SLO */}
            <EuiAccordion
              id="slo-section-target"
              buttonContent={
                <SectionButton
                  label="Section 2 — Set Service Level Objective (SLO)"
                  isComplete={sectionComplete[2]}
                  showIndicator={hasSubmitted || sectionComplete[2]}
                />
              }
              initialIsOpen
              paddingSize="m"
              data-test-subj="alertManager-sloWizard-section2"
            >
              <EuiCallOut
                title="Setting your SLO target"
                iconType="iInCircle"
                size="s"
                color="primary"
              >
                <p>
                  The target defines what percentage of requests (or time periods) must be
                  &quot;good&quot; within the measurement window. Common targets: 99.9% for
                  user-facing APIs, 99.5% for internal services, 99.0% for batch jobs.
                </p>
              </EuiCallOut>
              <EuiSpacer size="m" />
              <EuiFlexGroup gutterSize="m">
                <EuiFlexItem>
                  <EuiFormRow
                    label="Attainment goal (%)"
                    helpText="e.g. 99.9 for 99.9% availability — higher targets mean tighter error budgets"
                    isInvalid={hasSubmitted && !!validationErrors.target}
                    error={hasSubmitted ? validationErrors.target : undefined}
                  >
                    <EuiFieldNumber
                      value={target}
                      onChange={(e) => setTarget(e.target.value)}
                      min={90}
                      max={99.99}
                      step={0.01}
                      aria-label="Attainment goal percentage"
                      data-test-subj="alertManager-sloWizard-target"
                    />
                  </EuiFormRow>
                  <EuiFlexGroup gutterSize="xs" responsive={false} style={{ marginTop: 4 }}>
                    <EuiFlexItem grow={false}>
                      <EuiText size="xs" color="subdued" style={{ lineHeight: '24px' }}>
                        Quick set:
                      </EuiText>
                    </EuiFlexItem>
                    {[
                      { label: '99%', value: '99', hint: 'Batch jobs' },
                      { label: '99.5%', value: '99.5', hint: 'Internal' },
                      { label: '99.9%', value: '99.9', hint: 'User-facing' },
                      { label: '99.95%', value: '99.95', hint: 'Critical' },
                    ].map((preset) => (
                      <EuiFlexItem key={preset.value} grow={false}>
                        <EuiButtonEmpty
                          size="xs"
                          onClick={() => setTarget(preset.value)}
                          isSelected={target === preset.value}
                          aria-label={`Set target to ${preset.label} (${preset.hint})`}
                        >
                          {preset.label}
                        </EuiButtonEmpty>
                      </EuiFlexItem>
                    ))}
                  </EuiFlexGroup>
                </EuiFlexItem>
                <EuiFlexItem>
                  <EuiFormRow
                    label="Budget warning threshold (%)"
                    helpText="Alert when remaining error budget drops below this — e.g. 30 means warn at 30% remaining"
                    isInvalid={hasSubmitted && !!validationErrors.budgetWarningThreshold}
                  >
                    <EuiFieldNumber
                      value={budgetWarningThreshold}
                      onChange={(e) => setBudgetWarningThreshold(e.target.value)}
                      min={1}
                      max={99}
                      step={1}
                      aria-label="Budget warning threshold percentage"
                      data-test-subj="alertManager-sloWizard-budgetWarning"
                    />
                  </EuiFormRow>
                </EuiFlexItem>
              </EuiFlexGroup>
              <EuiSpacer size="m" />
              <EuiFormRow label="Measurement window" helpText="Rolling window duration">
                <EuiSelect
                  options={WINDOW_DURATION_OPTIONS}
                  value={windowDuration}
                  onChange={(e) => setWindowDuration(e.target.value)}
                  aria-label="Measurement window duration"
                  data-test-subj="alertManager-sloWizard-windowDuration"
                />
              </EuiFormRow>
              {errorBudgetDisplay && (
                <>
                  <EuiSpacer size="m" />
                  <EuiPanel color="subdued" paddingSize="m" hasBorder>
                    <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
                      <EuiFlexItem grow={false}>
                        <EuiIcon type="clock" size="l" color="primary" />
                      </EuiFlexItem>
                      <EuiFlexItem>
                        <EuiText size="s">
                          <strong>{errorBudgetDisplay.formatted}</strong>
                        </EuiText>
                        <EuiText size="xs" color="subdued">
                          Total allowable downtime within the measurement window
                        </EuiText>
                      </EuiFlexItem>
                    </EuiFlexGroup>
                  </EuiPanel>
                </>
              )}
            </EuiAccordion>

            <EuiSpacer size="m" />

            {/* Section 3: Set Name */}
            <EuiAccordion
              id="slo-section-name"
              buttonContent={
                <SectionButton
                  label="Section 3 — Set SLO Name"
                  isComplete={sectionComplete[3]}
                  showIndicator={hasSubmitted || sectionComplete[3]}
                />
              }
              initialIsOpen
              paddingSize="m"
              data-test-subj="alertManager-sloWizard-section3"
            >
              <EuiFormRow
                label="SLO name"
                isInvalid={hasSubmitted && !!validationErrors.name}
                error={hasSubmitted ? validationErrors.name : undefined}
              >
                <EuiFieldText
                  value={autoName ? generatedName : sloName}
                  onChange={(e) => {
                    setAutoName(false);
                    setSloName(e.target.value);
                  }}
                  placeholder="Auto-generated from service + operation"
                  aria-label="SLO name"
                  data-test-subj="alertManager-sloWizard-name"
                />
              </EuiFormRow>
              {!autoName && generatedName && (
                <EuiButtonEmpty size="xs" onClick={() => setAutoName(true)}>
                  Reset to auto-generated name
                </EuiButtonEmpty>
              )}
              <EuiSpacer size="s" />
              <EuiText size="xs" color="subdued">
                Rule group:{' '}
                <code>
                  slo:
                  {effectiveName
                    ? effectiveName
                        .toLowerCase()
                        .replace(/[^a-z0-9]/g, '_')
                        .replace(/_+/g, '_')
                        .slice(0, 40)
                    : '...'}
                </code>
              </EuiText>
            </EuiAccordion>

            <EuiSpacer size="m" />

            {/* Section 4: Burn Rate & Alarms */}
            <EuiAccordion
              id="slo-section-burnrate"
              buttonContent={
                <SectionButton
                  label="Section 4 — Set Expected Burn Rate and Alarms"
                  isComplete={sectionComplete[4]}
                  showIndicator={hasSubmitted || sectionComplete[4]}
                />
              }
              initialIsOpen
              paddingSize="m"
              data-test-subj="alertManager-sloWizard-section4"
            >
              <BurnRateSection
                burnRates={burnRates}
                alarms={alarms}
                windowDuration={windowDuration}
                hasSubmitted={hasSubmitted}
                errors={validationErrors}
                onBurnRatesChange={setBurnRates}
                onAlarmsChange={setAlarms}
              />
            </EuiAccordion>

            <EuiSpacer size="m" />

            {/* Section 5: Tags */}
            <EuiAccordion
              id="slo-section-tags"
              buttonContent="Section 5 — Add Tags (optional)"
              paddingSize="m"
              data-test-subj="alertManager-sloWizard-section5"
            >
              {tags.map((tag, i) => (
                <EuiFlexGroup
                  key={i}
                  gutterSize="s"
                  alignItems="center"
                  style={{ marginBottom: 4 }}
                >
                  <EuiFlexItem>
                    <EuiFieldText
                      compressed
                      placeholder="Key"
                      value={tag.key}
                      onChange={(e) => updateTag(i, 'key', e.target.value)}
                      aria-label="Tag key"
                      data-test-subj={`alertManager-sloWizard-tag-${i}-key`}
                    />
                  </EuiFlexItem>
                  <EuiFlexItem>
                    <EuiFieldText
                      compressed
                      placeholder="Value"
                      value={tag.value}
                      onChange={(e) => updateTag(i, 'value', e.target.value)}
                      aria-label="Tag value"
                      data-test-subj={`alertManager-sloWizard-tag-${i}-value`}
                    />
                  </EuiFlexItem>
                  <EuiFlexItem grow={false}>
                    <EuiButtonIcon
                      iconType="trash"
                      color="danger"
                      onClick={() => removeTag(i)}
                      aria-label="Remove tag"
                      data-test-subj={`alertManager-sloWizard-tag-${i}-remove`}
                    />
                  </EuiFlexItem>
                </EuiFlexGroup>
              ))}
              <EuiButtonEmpty
                size="s"
                onClick={addTag}
                iconType="plusInCircle"
                data-test-subj="alertManager-sloWizard-addTag"
              >
                Add tag
              </EuiButtonEmpty>
              <EuiSpacer size="s" />
              <EuiText size="xs" color="subdued">
                Tags are added to all generated rule labels with a <code>tag_</code> prefix.
              </EuiText>
            </EuiAccordion>
          </EuiFlexItem>

          {/* Right: Preview Panel */}
          <EuiFlexItem grow={2}>
            <SloPreviewPanel sloInput={sloInput} />
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiFlyoutBody>

      <EuiFlyoutFooter>
        <EuiFlexGroup justifyContent="spaceBetween">
          <EuiFlexItem grow={false}>
            <EuiButtonEmpty onClick={onClose} data-test-subj="alertManager-sloWizard-cancel">
              Cancel
            </EuiButtonEmpty>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiButton
              fill
              onClick={handleSubmit}
              isLoading={submitting}
              isDisabled={hasSubmitted && !isFormValid}
              data-test-subj="alertManager-sloWizard-submit"
            >
              Create SLO
            </EuiButton>
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiFlyoutFooter>
    </EuiFlyout>
  );
};
