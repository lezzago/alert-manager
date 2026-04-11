/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import ReactDOM from 'react-dom';
import { AppMountParameters, CoreStart } from 'opensearch-dashboards/public';
import { AppPluginStartDependencies } from './types';
import { AlarmsApp } from './components/app';

export const renderApp = (
  { notifications, http, application }: CoreStart,
  { navigation }: AppPluginStartDependencies,
  { appBasePath, element }: AppMountParameters
) => {
  ReactDOM.render(
    <AlarmsApp
      basename={appBasePath}
      notifications={notifications}
      http={http}
      navigation={navigation}
      application={application}
    />,
    element
  );

  return () => ReactDOM.unmountComponentAtNode(element);
};
