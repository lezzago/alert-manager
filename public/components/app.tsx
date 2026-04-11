/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * OSD-specific app wrapper — bridges OSD services to the shared AlarmsPage.
 */
import React from 'react';
import { I18nProvider } from '@osd/i18n/react';
import { BrowserRouter as Router } from 'react-router-dom';

import { CoreStart } from '../../../../src/core/public';
import { NavigationPublicPluginStart } from '../../../../src/plugins/navigation/public';

import { PLUGIN_ID } from '../../common';
import { AlarmsPage } from './alarms_page';
import { AlarmsApiClient } from '../services/alarms_client';
import { NavigationService } from '../services/navigation_service';
import { AlertManagerErrorBoundary } from './error_boundary';

interface AlarmsAppDeps {
  basename: string;
  notifications: CoreStart['notifications'];
  http: CoreStart['http'];
  navigation: NavigationPublicPluginStart;
  application?: CoreStart['application'];
}

/** Adapt OSD's HttpServiceBase to the HttpClient interface AlarmsPage expects */
function createOsdHttpClient(http: CoreStart['http']) {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- OSD HttpServiceBase options type
    get: <T,>(path: string, opts?: any) => http.get<T>(path, opts),
    post: <T,>(path: string, body?: unknown) =>
      http.post<T>(path, body ? { body: JSON.stringify(body) } : undefined),
    put: <T,>(path: string, body?: unknown) =>
      http.put<T>(path, body ? { body: JSON.stringify(body) } : undefined),
    delete: <T,>(path: string) => http.delete<T>(path),
  };
}

export const AlarmsApp = ({
  basename,
  notifications,
  http,
  navigation,
  application,
}: AlarmsAppDeps) => {
  const apiClient = new AlarmsApiClient(createOsdHttpClient(http));
  const navigationService = new NavigationService(application, 'osd');

  return (
    <Router basename={basename}>
      <I18nProvider>
        <AlertManagerErrorBoundary>
          <>
            {navigation?.ui?.TopNavMenu && (
              <navigation.ui.TopNavMenu
                appName={PLUGIN_ID}
                showSearchBar={false}
                useDefaultBehaviors={true}
              />
            )}
            <AlarmsPage apiClient={apiClient} navigationService={navigationService} />
          </>
        </AlertManagerErrorBoundary>
      </I18nProvider>
    </Router>
  );
};
