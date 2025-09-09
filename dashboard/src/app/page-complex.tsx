/**
 * @fileoverview Dashboard Home Page with real-time data overview
 * @author QuantLink Team
 * @version 1.0.0
 */

import { Suspense } from 'react';
import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { DashboardShell } from '@/components/dashboard/dashboard-shell';
import { DashboardHeader } from '@/components/dashboard/dashboard-header';
import { DashboardContent } from '@/components/dashboard/dashboard-content';
import { MetricsOverview } from '@/components/dashboard/metrics-overview';
import { RealTimeChart } from '@/components/charts/real-time-chart';
import { DataTable } from '@/components/data-table/data-table';
import { ConnectionStatus } from '@/components/websocket/connection-status';
import { LoadingSkeleton } from '@/components/ui/loading-skeleton';
import { ErrorBoundary } from '@/components/error-boundary';

export const metadata: Metadata = {
  title: 'Dashboard Overview',
  description: 'Real-time overview of QuantLink Oracle data with live metrics and analytics.',
};

// Force dynamic rendering for real-time data
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function DashboardPage() {
  return (
    <DashboardShell>
      <DashboardHeader
        title="Dashboard Overview"
        description="Real-time monitoring of oracle data feeds and system metrics"
      >
        <ConnectionStatus />
      </DashboardHeader>

      <DashboardContent>
        {/* Metrics Overview Section */}
        <section 
          className="space-y-6"
          aria-labelledby="metrics-heading"
        >
          <h2 id="metrics-heading" className="sr-only">
            System Metrics Overview
          </h2>
          
          <ErrorBoundary fallback={<MetricsErrorFallback />}>
            <Suspense fallback={<MetricsLoadingSkeleton />}>
              <MetricsOverview />
            </Suspense>
          </ErrorBoundary>
        </section>

        {/* Real-time Charts Section */}
        <section 
          className="space-y-6"
          aria-labelledby="charts-heading"
        >
          <h2 id="charts-heading" className="text-2xl font-semibold tracking-tight">
            Real-time Data Visualization
          </h2>
          
          <div className="grid gap-6 md:grid-cols-2">
            {/* CEX Fee Chart */}
            <ErrorBoundary fallback={<ChartErrorFallback title="CEX Fees" />}>
              <Suspense fallback={<ChartLoadingSkeleton />}>
                <RealTimeChart
                  title="CEX Fee Trends"
                  description="Real-time centralized exchange fee data"
                  dataType="cex_fees"
                  symbol="BTC/USDT"
                  height={300}
                  showLegend
                  showTooltip
                  enableZoom
                  enablePan
                />
              </Suspense>
            </ErrorBoundary>

            {/* DEX Fee Chart */}
            <ErrorBoundary fallback={<ChartErrorFallback title="DEX Fees" />}>
              <Suspense fallback={<ChartLoadingSkeleton />}>
                <RealTimeChart
                  title="DEX Fee Trends"
                  description="Real-time decentralized exchange fee data"
                  dataType="dex_fees"
                  symbol="BTC/USDT"
                  height={300}
                  showLegend
                  showTooltip
                  enableZoom
                  enablePan
                />
              </Suspense>
            </ErrorBoundary>
          </div>

          {/* Combined Price Chart */}
          <ErrorBoundary fallback={<ChartErrorFallback title="Price Data" />}>
            <Suspense fallback={<ChartLoadingSkeleton />}>
              <RealTimeChart
                title="Price Aggregation"
                description="Real-time price data from multiple sources"
                dataType="price_data"
                symbol="BTC/USDT"
                height={400}
                showLegend
                showTooltip
                enableZoom
                enablePan
                showVolume
              />
            </Suspense>
          </ErrorBoundary>
        </section>

        {/* Data Tables Section */}
        <section 
          className="space-y-6"
          aria-labelledby="tables-heading"
        >
          <h2 id="tables-heading" className="text-2xl font-semibold tracking-tight">
            Live Data Feeds
          </h2>
          
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Oracle Data Table */}
            <ErrorBoundary fallback={<TableErrorFallback title="Oracle Data" />}>
              <Suspense fallback={<TableLoadingSkeleton />}>
                <DataTable
                  title="Oracle Data"
                  description="Aggregated oracle data with confidence scores"
                  dataType="oracle_data"
                  columns={[
                    { key: 'symbol', label: 'Symbol', sortable: true },
                    { key: 'weightedMedianCexFee', label: 'CEX Fee', sortable: true, format: 'percentage' },
                    { key: 'weightedMedianDexFee', label: 'DEX Fee', sortable: true, format: 'percentage' },
                    { key: 'confidence', label: 'Confidence', sortable: true, format: 'percentage' },
                    { key: 'timestamp', label: 'Updated', sortable: true, format: 'time' },
                  ]}
                  pageSize={10}
                  enableSearch
                  enableFilters
                  enableExport
                  realTime
                />
              </Suspense>
            </ErrorBoundary>

            {/* Health Status Table */}
            <ErrorBoundary fallback={<TableErrorFallback title="System Health" />}>
              <Suspense fallback={<TableLoadingSkeleton />}>
                <DataTable
                  title="System Health"
                  description="Real-time health status of data sources"
                  dataType="health_status"
                  columns={[
                    { key: 'sourceId', label: 'Source', sortable: true },
                    { key: 'healthState', label: 'Status', sortable: true, format: 'status' },
                    { key: 'latencyMs', label: 'Latency', sortable: true, format: 'duration' },
                    { key: 'uptimePercentage', label: 'Uptime', sortable: true, format: 'percentage' },
                    { key: 'lastUpdate', label: 'Last Update', sortable: true, format: 'time' },
                  ]}
                  pageSize={10}
                  enableSearch
                  enableFilters
                  realTime
                />
              </Suspense>
            </ErrorBoundary>
          </div>
        </section>

        {/* Performance Metrics Section */}
        <section 
          className="space-y-6"
          aria-labelledby="performance-heading"
        >
          <h2 id="performance-heading" className="text-2xl font-semibold tracking-tight">
            Performance Metrics
          </h2>
          
          <div className="grid gap-6 md:grid-cols-3">
            {/* WebSocket Metrics */}
            <ErrorBoundary fallback={<MetricCardErrorFallback title="WebSocket" />}>
              <Suspense fallback={<MetricCardLoadingSkeleton />}>
                <WebSocketMetrics />
              </Suspense>
            </ErrorBoundary>

            {/* Data Quality Metrics */}
            <ErrorBoundary fallback={<MetricCardErrorFallback title="Data Quality" />}>
              <Suspense fallback={<MetricCardLoadingSkeleton />}>
                <DataQualityMetrics />
              </Suspense>
            </ErrorBoundary>

            {/* System Performance */}
            <ErrorBoundary fallback={<MetricCardErrorFallback title="System Performance" />}>
              <Suspense fallback={<MetricCardLoadingSkeleton />}>
                <SystemPerformanceMetrics />
              </Suspense>
            </ErrorBoundary>
          </div>
        </section>
      </DashboardContent>
    </DashboardShell>
  );
}

// Loading Skeletons
function MetricsLoadingSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="card p-6">
          <div className="space-y-2">
            <div className="h-4 w-24 loading-skeleton rounded" />
            <div className="h-8 w-16 loading-skeleton rounded" />
            <div className="h-3 w-32 loading-skeleton rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ChartLoadingSkeleton() {
  return (
    <div className="card p-6">
      <div className="space-y-4">
        <div className="space-y-2">
          <div className="h-6 w-32 loading-skeleton rounded" />
          <div className="h-4 w-48 loading-skeleton rounded" />
        </div>
        <div className="h-64 w-full loading-skeleton rounded" />
      </div>
    </div>
  );
}

function TableLoadingSkeleton() {
  return (
    <div className="card p-6">
      <div className="space-y-4">
        <div className="space-y-2">
          <div className="h-6 w-32 loading-skeleton rounded" />
          <div className="h-4 w-48 loading-skeleton rounded" />
        </div>
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex space-x-4">
              {Array.from({ length: 5 }).map((_, j) => (
                <div key={j} className="h-4 flex-1 loading-skeleton rounded" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MetricCardLoadingSkeleton() {
  return (
    <div className="card p-6">
      <div className="space-y-2">
        <div className="h-4 w-24 loading-skeleton rounded" />
        <div className="h-8 w-16 loading-skeleton rounded" />
        <div className="h-3 w-32 loading-skeleton rounded" />
      </div>
    </div>
  );
}

// Error Fallbacks
function MetricsErrorFallback() {
  return (
    <div className="card p-6 border-destructive">
      <div className="text-center space-y-2">
        <p className="text-destructive font-medium">Failed to load metrics</p>
        <p className="text-sm text-muted-foreground">Please refresh the page or check your connection</p>
      </div>
    </div>
  );
}

function ChartErrorFallback({ title }: { title: string }) {
  return (
    <div className="card p-6 border-destructive">
      <div className="text-center space-y-2">
        <p className="text-destructive font-medium">Failed to load {title}</p>
        <p className="text-sm text-muted-foreground">Chart data is temporarily unavailable</p>
      </div>
    </div>
  );
}

function TableErrorFallback({ title }: { title: string }) {
  return (
    <div className="card p-6 border-destructive">
      <div className="text-center space-y-2">
        <p className="text-destructive font-medium">Failed to load {title}</p>
        <p className="text-sm text-muted-foreground">Table data is temporarily unavailable</p>
      </div>
    </div>
  );
}

function MetricCardErrorFallback({ title }: { title: string }) {
  return (
    <div className="card p-6 border-destructive">
      <div className="text-center space-y-2">
        <p className="text-destructive font-medium">Failed to load {title}</p>
        <p className="text-sm text-muted-foreground">Metrics temporarily unavailable</p>
      </div>
    </div>
  );
}

// Lazy-loaded components
import dynamic from 'next/dynamic';

const WebSocketMetrics = dynamic(
  () => import('@/components/metrics/websocket-metrics'),
  { 
    loading: () => <MetricCardLoadingSkeleton />,
    ssr: false 
  }
);

const DataQualityMetrics = dynamic(
  () => import('@/components/metrics/data-quality-metrics'),
  { 
    loading: () => <MetricCardLoadingSkeleton />,
    ssr: false 
  }
);

const SystemPerformanceMetrics = dynamic(
  () => import('@/components/metrics/system-performance-metrics'),
  { 
    loading: () => <MetricCardLoadingSkeleton />,
    ssr: false 
  }
);
