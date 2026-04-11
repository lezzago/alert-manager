/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Standalone React entry point — no OSD dependencies.
 * Uses the standalone AlarmsPage and its co-located API client.
 */
import React from 'react';
import ReactDOM from 'react-dom';
import { BrowserRouter as Router } from 'react-router-dom';

// OUI CSS
import '@opensearch-project/oui/dist/eui_theme_light.css';

// OUI Context for proper styling
import { OuiContext } from '@opensearch-project/oui/lib/components/context';

import { AlarmsPage, AlarmsApiClient, HttpClient } from './components/alarms_page';
import { AlertManagerErrorBoundary } from './components/error_boundary';
import { NavigationService } from '../public/services/navigation_service';

/** Simple fetch-based HTTP client for standalone mode */
const standaloneHttp: HttpClient = {
  get: async <T extends unknown>(
    path: string,
    opts?: { query?: Record<string, string | undefined> }
  ): Promise<T> => {
    let url = path;
    if (opts?.query) {
      const params = new URLSearchParams();
      Object.entries(opts.query).forEach(([k, v]) => {
        if (v !== undefined) params.set(k, v);
      });
      const qs = params.toString();
      if (qs) url = `${path}?${qs}`;
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
    return res.json();
  },
  post: async <T extends unknown>(path: string, body?: unknown): Promise<T> => {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
    return res.json();
  },
  put: async <T extends unknown>(path: string, body?: unknown): Promise<T> => {
    const res = await fetch(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`PUT ${path} failed: ${res.status}`);
    return res.json();
  },
  delete: async <T extends unknown>(path: string): Promise<T> => {
    const res = await fetch(path, { method: 'DELETE' });
    if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status}`);
    return res.json();
  },
};

const apiClient = new AlarmsApiClient(standaloneHttp, 'standalone');
const navigationService = new NavigationService(undefined, 'standalone');

const App = () => (
  <OuiContext>
    <Router>
      <AlertManagerErrorBoundary>
        <AlarmsPage apiClient={apiClient} navigationService={navigationService} />
      </AlertManagerErrorBoundary>
    </Router>
  </OuiContext>
);

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.render(<App />, rootElement);
} else {
  console.error('Root element not found!');
}
