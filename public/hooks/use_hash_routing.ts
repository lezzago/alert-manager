/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * React hook for bidirectional sync between URL hash and component state.
 * Enables deep-linkable views in Alert Manager (Phase 4).
 *
 * Hash format:
 *   #/alerts                       → Alerts tab
 *   #/alerts/{dsId}/{alertId}      → Alert detail flyout
 *   #/rules                        → Rules tab
 *   #/slos                         → SLOs tab
 *   #/slos/{sloId}                 → SLO detail flyout
 *   #/services                     → Services tab
 *   #/services/{serviceName}       → Service detail flyout
 *   #/routing                      → Routing tab
 *   #/suppression                  → Suppression tab
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { parseHash, buildHash, HashRoute, AlertManagerTab } from '../../common/deep_links';

export interface HashRoutingState {
  /** Currently active tab. */
  tab: AlertManagerTab;
  /** Alert detail identifiers (when a flyout should be open). */
  alertDetail: { datasourceId: string; alertId: string } | null;
  /** SLO ID to open in detail flyout. */
  sloId: string | null;
  /** Service name to open in detail flyout. */
  serviceName: string | null;
}

export interface HashRoutingActions {
  /** Switch to a tab (clears any open detail). */
  setTab: (tab: AlertManagerTab) => void;
  /** Open an alert detail flyout (switches to alerts tab). */
  openAlert: (datasourceId: string, alertId: string) => void;
  /** Close the alert detail flyout (stays on alerts tab). */
  closeAlert: () => void;
  /** Open an SLO detail flyout (switches to slos tab). */
  openSlo: (sloId: string) => void;
  /** Close the SLO detail flyout (stays on slos tab). */
  closeSlo: () => void;
  /** Open a service detail flyout (switches to services tab). */
  openService: (serviceName: string) => void;
  /** Close the service detail flyout (stays on services tab). */
  closeService: () => void;
}

function routeToState(route: HashRoute): HashRoutingState {
  return {
    tab: route.tab,
    alertDetail: route.alertDetail ?? null,
    sloId: route.sloId ?? null,
    serviceName: route.serviceName ?? null,
  };
}

function stateToRoute(state: HashRoutingState): HashRoute {
  const route: HashRoute = { tab: state.tab };
  if (state.tab === 'alerts' && state.alertDetail) {
    route.alertDetail = state.alertDetail;
  }
  if (state.tab === 'slos' && state.sloId) {
    route.sloId = state.sloId;
  }
  if (state.tab === 'services' && state.serviceName) {
    route.serviceName = state.serviceName;
  }
  return route;
}

/**
 * Hook that provides bidirectional URL hash <-> component state sync.
 *
 * - On mount, reads the current hash and initializes state.
 * - When state changes (via actions), updates the hash.
 * - When the hash changes externally (back/forward button), updates state.
 */
export function useHashRouting(): [HashRoutingState, HashRoutingActions] {
  // Suppress hash -> state sync when we're the ones updating the hash
  const suppressHashSync = useRef(false);

  const [state, setState] = useState<HashRoutingState>(() =>
    routeToState(parseHash(window.location.hash))
  );

  // Update the URL hash when state changes
  const updateHash = useCallback((newState: HashRoutingState) => {
    const hash = buildHash(stateToRoute(newState));
    suppressHashSync.current = true;
    // Set hash directly — triggers hashchange but we suppress it.
    // Using location.hash instead of replaceState for broader compatibility.
    window.location.hash = hash.substring(1); // strip leading '#'
    setState(newState);
    // Reset suppression on next tick
    setTimeout(() => {
      suppressHashSync.current = false;
    }, 0);
  }, []);

  // Listen for external hash changes (back/forward button)
  useEffect(() => {
    const handleHashChange = () => {
      if (suppressHashSync.current) return;
      setState(routeToState(parseHash(window.location.hash)));
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Set initial hash if empty
  useEffect(() => {
    if (!window.location.hash || window.location.hash === '#' || window.location.hash === '#/') {
      suppressHashSync.current = true;
      window.location.hash = buildHash(stateToRoute(state)).substring(1);
      setTimeout(() => {
        suppressHashSync.current = false;
      }, 0);
    }
    // Only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const actions: HashRoutingActions = {
    setTab: useCallback((tab: AlertManagerTab) => {
      const newState: HashRoutingState = {
        tab,
        alertDetail: null,
        sloId: null,
        serviceName: null,
      };
      const hash = buildHash(stateToRoute(newState));
      suppressHashSync.current = true;
      window.location.hash = hash.substring(1);
      setState(newState);
      setTimeout(() => {
        suppressHashSync.current = false;
      }, 0);
    }, []),

    openAlert: useCallback(
      (datasourceId: string, alertId: string) => {
        updateHash({
          tab: 'alerts',
          alertDetail: { datasourceId, alertId },
          sloId: null,
          serviceName: null,
        });
      },
      [updateHash]
    ),

    closeAlert: useCallback(() => {
      updateHash({ tab: 'alerts', alertDetail: null, sloId: null, serviceName: null });
    }, [updateHash]),

    openSlo: useCallback(
      (sloId: string) => {
        updateHash({ tab: 'slos', alertDetail: null, sloId, serviceName: null });
      },
      [updateHash]
    ),

    closeSlo: useCallback(() => {
      updateHash({ tab: 'slos', alertDetail: null, sloId: null, serviceName: null });
    }, [updateHash]),

    openService: useCallback(
      (serviceName: string) => {
        updateHash({ tab: 'services', alertDetail: null, sloId: null, serviceName });
      },
      [updateHash]
    ),

    closeService: useCallback(() => {
      updateHash({ tab: 'services', alertDetail: null, sloId: null, serviceName: null });
    }, [updateHash]),
  };

  return [state, actions];
}
