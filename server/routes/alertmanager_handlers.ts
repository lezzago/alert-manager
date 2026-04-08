/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Alertmanager route handlers — shared between standalone and OSD plugin.
 * Each handler takes a PrometheusBackend and returns { status, body }.
 */
import yaml from 'js-yaml';
import { PrometheusBackend } from '../../core';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Result = { status: number; body: any };

// ============================================================================
// Alertmanager API v2 Handlers
// ============================================================================

export async function handleGetAlertmanagerAlerts(
  promBackend: PrometheusBackend
): Promise<Result> {
  try {
    if (!promBackend.getAlertmanagerAlerts) {
      return { status: 501, body: { error: 'Alertmanager not configured' } };
    }
    const alerts = await promBackend.getAlertmanagerAlerts();
    return { status: 200, body: { alerts } };
  } catch (e: unknown) {
    return { status: 500, body: { error: String(e) } };
  }
}

export async function handleGetAlertmanagerSilences(
  promBackend: PrometheusBackend
): Promise<Result> {
  try {
    if (!promBackend.getSilences) {
      return { status: 501, body: { error: 'Alertmanager not configured' } };
    }
    const silences = await promBackend.getSilences();
    return { status: 200, body: { silences } };
  } catch (e: unknown) {
    return { status: 500, body: { error: String(e) } };
  }
}

export async function handleCreateAlertmanagerSilence(
  promBackend: PrometheusBackend,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any
): Promise<Result> {
  try {
    if (!promBackend.createSilence) {
      return { status: 501, body: { error: 'Alertmanager not configured' } };
    }
    const silenceId = await promBackend.createSilence(body);
    return { status: 200, body: { silenceID: silenceId } };
  } catch (e: unknown) {
    return { status: 500, body: { error: String(e) } };
  }
}

export async function handleDeleteAlertmanagerSilence(
  promBackend: PrometheusBackend,
  id: string
): Promise<Result> {
  try {
    if (!promBackend.deleteSilence) {
      return { status: 501, body: { error: 'Alertmanager not configured' } };
    }
    const ok = await promBackend.deleteSilence(id);
    return { status: 200, body: { success: ok } };
  } catch (e: unknown) {
    return { status: 500, body: { error: String(e) } };
  }
}

export async function handleGetAlertmanagerStatus(
  promBackend: PrometheusBackend
): Promise<Result> {
  try {
    if (!promBackend.getAlertmanagerStatus) {
      return { status: 501, body: { error: 'Alertmanager not configured' } };
    }
    const status = await promBackend.getAlertmanagerStatus();
    return { status: 200, body: status };
  } catch (e: unknown) {
    return { status: 500, body: { error: String(e) } };
  }
}

export async function handleGetAlertmanagerReceivers(
  promBackend: PrometheusBackend
): Promise<Result> {
  try {
    if (!promBackend.getAlertmanagerReceivers) {
      return { status: 501, body: { error: 'Alertmanager receivers not available' } };
    }
    const receivers = await promBackend.getAlertmanagerReceivers();
    return { status: 200, body: { receivers } };
  } catch (e: unknown) {
    return { status: 500, body: { error: String(e) } };
  }
}

export async function handleGetAlertmanagerAlertGroups(
  promBackend: PrometheusBackend
): Promise<Result> {
  try {
    if (!promBackend.getAlertmanagerAlertGroups) {
      return { status: 501, body: { error: 'Alertmanager alert groups not available' } };
    }
    const groups = await promBackend.getAlertmanagerAlertGroups();
    return { status: 200, body: { groups } };
  } catch (e: unknown) {
    return { status: 500, body: { error: String(e) } };
  }
}

// ============================================================================
// Alertmanager Config (parsed YAML)
// ============================================================================

/**
 * Extract integration types from a receiver's *_configs keys.
 * Shared by both standalone and OSD config endpoints.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractReceiverIntegrations(receiver: any): Array<{ type: string; summary: string }> {
  const integrations: Array<{ type: string; summary: string }> = [];
  const configKeys = [
    'webhook_configs',
    'slack_configs',
    'email_configs',
    'pagerduty_configs',
    'opsgenie_configs',
    'victorops_configs',
    'pushover_configs',
    'wechat_configs',
    'sns_configs',
    'telegram_configs',
    'msteams_configs',
    'webex_configs',
  ];
  for (const key of configKeys) {
    if (receiver[key] && Array.isArray(receiver[key])) {
      for (const cfg of receiver[key]) {
        const typeName = key.replace('_configs', '');
        let summary = '';
        if (typeName === 'webhook') summary = cfg.url || cfg.url_file || 'webhook';
        else if (typeName === 'slack') summary = cfg.channel || 'slack';
        else if (typeName === 'email') summary = cfg.to || 'email';
        else if (typeName === 'pagerduty') summary = cfg.service_key || cfg.api_url || 'pagerduty';
        else summary = cfg.url || cfg.api_url || typeName;
        integrations.push({ type: typeName, summary: String(summary) });
      }
    }
  }
  if (integrations.length === 0) {
    integrations.push({ type: 'none', summary: 'No integrations' });
  }
  return integrations;
}

/**
 * Fetch Alertmanager status, parse the YAML config, and return structured data.
 * Merges the duplicated logic from standalone/server.ts and server/routes/index.ts.
 */
export async function handleGetAlertmanagerConfig(
  promBackend: PrometheusBackend
): Promise<Result> {
  try {
    if (!promBackend.getAlertmanagerStatus) {
      return { status: 200, body: { available: false, error: 'Alertmanager not configured' } };
    }
    const status = await promBackend.getAlertmanagerStatus();
    const rawYaml = status.config?.original || '';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let parsedConfig: Record<string, any> | undefined;
    let configParseError: string | undefined;

    if (rawYaml) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const parsed = yaml.load(rawYaml) as Record<string, any>;
        if (parsed && typeof parsed === 'object') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const receivers = (parsed.receivers || []).map((r: any) => ({
            name: r.name,
            integrations: extractReceiverIntegrations(r),
          }));

          parsedConfig = {
            global: parsed.global || {},
            route: parsed.route || null,
            receivers,
            inhibitRules: parsed.inhibit_rules || [],
          };
        }
      } catch (yamlErr: unknown) {
        configParseError = `Failed to parse YAML: ${String(yamlErr)}`;
      }
    }

    return {
      status: 200,
      body: {
        available: true,
        cluster: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          status: (status.cluster as any)?.status || 'unknown',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          peers: (status.cluster as any)?.peers || [],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          peerCount: ((status.cluster as any)?.peers || []).length,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        uptime: (status as any).uptime,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        versionInfo: (status as any).versionInfo || {},
        config: parsedConfig,
        configParseError,
        raw: rawYaml,
      },
    };
  } catch (e: unknown) {
    return { status: 200, body: { available: false, error: String(e) } };
  }
}
