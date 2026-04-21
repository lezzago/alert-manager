/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect } from 'react';
import { EuiLoadingChart, EuiText } from '@elastic/eui';
import * as echarts from 'echarts';

export interface MetricDataPoint {
  timestamp: number;
  value: number;
}

interface MetricSparklineProps {
  data: MetricDataPoint[];
  isLoading?: boolean;
  isError?: boolean;
  color?: string;
  height?: number;
  width?: number;
}

const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
};

/**
 * Lightweight inline sparkline chart for service metrics.
 * Renders a minimal ECharts chart with gradient fill and no axes or interactivity.
 */
export const MetricSparkline: React.FC<MetricSparklineProps> = ({
  data,
  isLoading = false,
  isError = false,
  color = '#54B399',
  height = 20,
  width,
}) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!chartRef.current || isLoading || isError || !data || data.length === 0) {
      return;
    }

    if (!chartInstance.current) {
      chartInstance.current = echarts.init(chartRef.current);
    }

    const rgb = hexToRgb(color) || { r: 84, g: 179, b: 153 };

    const option: echarts.EChartsOption = {
      grid: { left: 0, right: 0, top: 0, bottom: 0 },
      xAxis: {
        type: 'category',
        show: false,
        data: data.map((d) => d.timestamp),
        boundaryGap: false,
      },
      yAxis: { type: 'value', show: false },
      tooltip: { show: false },
      series: [
        {
          type: 'line',
          data: data.map((d) => d.value),
          smooth: true,
          symbol: 'none',
          lineStyle: { color, width: 1.5 },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.4)` },
              { offset: 1, color: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)` },
            ]),
          },
          emphasis: { disabled: true },
          silent: true,
        },
      ],
    };

    chartInstance.current.setOption(option);
  }, [data, color, isLoading, isError]);

  useEffect(() => {
    return () => {
      chartInstance.current?.dispose();
      chartInstance.current = null;
    };
  }, []);

  useEffect(() => {
    const handleResize = () => chartInstance.current?.resize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height,
    width: width ? `${width}px` : '100%',
  };

  if (isLoading) {
    return (
      <div style={containerStyle}>
        <EuiLoadingChart size="m" mono />
      </div>
    );
  }

  if (isError || !data || data.length === 0) {
    return (
      <div style={containerStyle}>
        <EuiText size="xs" color="subdued">
          -
        </EuiText>
      </div>
    );
  }

  return (
    <div
      ref={chartRef}
      style={{ width: width ? `${width}px` : '100%', height: `${height}px` }}
      data-test-subj="metric-sparkline"
    />
  );
};
