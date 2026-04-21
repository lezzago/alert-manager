/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared mock data for Prometheus metrics, labels, and label values.
 *
 * Extracted from `public/components/promql_editor.tsx` so that both the
 * PromQL editor (public/) and the mock backend (common/) can reference the
 * same data without a `common -> public` dependency.
 */

export const MOCK_METRICS: readonly string[] = [
  'node_cpu_seconds_total',
  'node_memory_MemTotal_bytes',
  'node_memory_MemAvailable_bytes',
  'node_memory_MemFree_bytes',
  'node_filesystem_avail_bytes',
  'node_filesystem_size_bytes',
  'node_disk_read_bytes_total',
  'node_disk_written_bytes_total',
  'node_network_receive_bytes_total',
  'node_network_transmit_bytes_total',
  'node_network_receive_drop_total',
  'node_load1',
  'node_load5',
  'node_load15',
  'http_requests_total',
  'http_request_duration_seconds_bucket',
  'http_request_duration_seconds_sum',
  'http_request_duration_seconds_count',
  'http_request_size_bytes',
  'http_response_size_bytes',
  'up',
  'scrape_duration_seconds',
  'scrape_samples_scraped',
  'process_cpu_seconds_total',
  'process_resident_memory_bytes',
  'process_open_fds',
  'go_goroutines',
  'go_gc_duration_seconds',
  'go_memstats_alloc_bytes',
  'kube_pod_container_status_restarts_total',
  'kube_pod_status_phase',
  'kube_deployment_status_replicas',
  'kube_node_status_condition',
  'kube_pod_container_resource_limits',
  'kube_pod_container_resource_requests',
  'db_connection_pool_available',
  'db_connection_pool_total',
  'db_query_duration_seconds',
  'probe_ssl_earliest_cert_expiry',
  'probe_http_duration_seconds',
  'probe_success',
  'container_cpu_usage_seconds_total',
  'container_memory_usage_bytes',
  'container_network_receive_bytes_total',
  // OTEL span-derived metrics (Data Prepper)
  'request',
  'latency_seconds_bucket',
  'latency_seconds_count',
  'latency_seconds_sum',
  // gRPC metrics
  'grpc_server_handled_total',
  'grpc_server_handling_seconds_bucket',
] as const;

export const MOCK_LABEL_NAMES: readonly string[] = [
  'instance',
  'job',
  'mode',
  'cpu',
  'device',
  'mountpoint',
  'fstype',
  'severity',
  'alertname',
  'team',
  'service',
  'environment',
  'region',
  'namespace',
  'pod',
  'container',
  'node',
  'le',
  'quantile',
  'method',
  'status',
  'handler',
  'code',
  'application',
  'status_code',
  'grpc_code',
  'grpc_service',
  'grpc_method',
  'endpoint',
  'peer_service',
  'remoteService',
  'fault',
] as const;

export const MOCK_LABEL_VALUES: Readonly<Record<string, readonly string[]>> = {
  instance: ['i-0abc123:9100', 'i-0def456:9100', 'i-0ghi789:9100', 'api-gateway:8080'],
  job: ['node-exporter', 'prometheus', 'api-gateway', 'kubernetes', 'blackbox-exporter'],
  mode: ['idle', 'user', 'system', 'iowait', 'nice', 'irq', 'softirq', 'steal'],
  severity: ['critical', 'warning', 'info'],
  team: ['infra', 'platform', 'sre', 'security', 'data', 'network'],
  service: [
    'node-exporter',
    'api-gateway',
    'kubernetes',
    'postgres',
    'blackbox-exporter',
    'payment-service',
    'order-service',
    'checkout-service',
    'notification-service',
    'user-auth',
    'pet-clinic-frontend',
  ],
  environment: ['production', 'staging', 'development'],
  region: ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-1'],
  namespace: ['production', 'staging', 'kube-system', 'monitoring', 'span_derived', 'default'],
  method: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  status: ['200', '201', '301', '400', '401', '403', '404', '500', '502', '503'],
  application: ['checkout', 'platform', 'user-service', 'order-service', 'observability'],
  status_code: ['200', '201', '301', '400', '401', '403', '404', '500', '502', '503'],
  grpc_code: [
    'OK',
    'CANCELLED',
    'UNKNOWN',
    'INVALID_ARGUMENT',
    'DEADLINE_EXCEEDED',
    'NOT_FOUND',
    'ALREADY_EXISTS',
    'PERMISSION_DENIED',
    'RESOURCE_EXHAUSTED',
    'FAILED_PRECONDITION',
    'ABORTED',
    'OUT_OF_RANGE',
    'UNIMPLEMENTED',
    'INTERNAL',
    'UNAVAILABLE',
    'DATA_LOSS',
    'UNAUTHENTICATED',
  ],
  grpc_service: [
    'user.UserService',
    'order.OrderService',
    'payment.PaymentService',
    'inventory.InventoryService',
  ],
  grpc_method: ['GetUser', 'CreateOrder', 'ProcessPayment', 'CheckInventory', 'ListItems'],
  endpoint: ['/', '/api/health', '/api/users', '/api/orders', '/api/payments', '/api/inventory'],
  peer_service: ['payment-api', 'order-api', 'user-api', 'inventory-api', 'notification-api'],
  remoteService: [
    'payment-service',
    'order-service',
    'postgres',
    'notification-service',
    'user-auth',
  ],
  fault: ['0', '1'],
} as const;

// ============================================================================
// Mock Sparkline Data — 7-day daily data points for service trend columns
// ============================================================================

export interface MockServiceTrend {
  /** Daily alert firing count over the past 7 days. */
  alertTrend: Array<{ timestamp: number; value: number }>;
  /** Daily error budget remaining % (0-100) over the past 7 days. */
  errorBudgetTrend: Array<{ timestamp: number; value: number }>;
}

const DAY_MS = 86_400_000;

/** Generates 7 daily timestamps ending at today midnight UTC. */
const last7Days = (): number[] => {
  const now = new Date();
  const todayMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: 7 }, (_, i) => todayMidnight - (6 - i) * DAY_MS);
};

const ts = last7Days();

/**
 * Per-service sparkline mock data keyed by service name.
 * Patterns reflect realistic SRE scenarios: healthy services have flat trends,
 * degraded services show rising alerts and declining error budgets.
 */
export const MOCK_SERVICE_TRENDS: Readonly<Record<string, MockServiceTrend>> = {
  'api-gateway': {
    alertTrend: ts.map((t, i) => ({ timestamp: t, value: [0, 1, 0, 2, 3, 1, 0][i] })),
    errorBudgetTrend: ts.map((t, i) => ({ timestamp: t, value: [98, 97, 97, 95, 92, 93, 94][i] })),
  },
  'payment-service': {
    alertTrend: ts.map((t, i) => ({ timestamp: t, value: [1, 2, 3, 5, 4, 6, 3][i] })),
    errorBudgetTrend: ts.map((t, i) => ({ timestamp: t, value: [90, 85, 78, 70, 68, 60, 62][i] })),
  },
  'order-service': {
    alertTrend: ts.map((t, i) => ({ timestamp: t, value: [0, 0, 1, 0, 0, 1, 0][i] })),
    errorBudgetTrend: ts.map((t, i) => ({ timestamp: t, value: [99, 99, 98, 99, 99, 98, 99][i] })),
  },
  'pet-clinic-frontend': {
    alertTrend: ts.map((t, i) => ({ timestamp: t, value: [0, 0, 0, 0, 1, 0, 0][i] })),
    errorBudgetTrend: ts.map((t, i) => ({
      timestamp: t,
      value: [100, 100, 100, 100, 99, 100, 100][i],
    })),
  },
  'checkout-service': {
    alertTrend: ts.map((t, i) => ({ timestamp: t, value: [2, 3, 4, 6, 8, 7, 5][i] })),
    errorBudgetTrend: ts.map((t, i) => ({ timestamp: t, value: [80, 72, 60, 45, 30, 25, 28][i] })),
  },
  'notification-service': {
    alertTrend: ts.map((t, i) => ({ timestamp: t, value: [0, 0, 0, 0, 0, 0, 0][i] })),
    errorBudgetTrend: ts.map((t, i) => ({
      timestamp: t,
      value: [100, 100, 100, 100, 100, 100, 100][i],
    })),
  },
  'user-auth': {
    alertTrend: ts.map((t, i) => ({ timestamp: t, value: [0, 1, 0, 0, 2, 1, 0][i] })),
    errorBudgetTrend: ts.map((t, i) => ({ timestamp: t, value: [97, 96, 96, 96, 93, 94, 95][i] })),
  },
  postgres: {
    alertTrend: ts.map((t, i) => ({ timestamp: t, value: [0, 0, 0, 1, 0, 0, 0][i] })),
    errorBudgetTrend: ts.map((t, i) => ({ timestamp: t, value: [99, 99, 99, 98, 99, 99, 99][i] })),
  },
} as const;
