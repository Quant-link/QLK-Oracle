/**
 * @fileoverview Data Table component with real-time updates
 * @author QuantLink Team
 * @version 1.0.0
 */

'use client';

import React, { useState, useMemo } from 'react';
import { useWebSocketStore } from '@/lib/store/websocket-store';
import { formatPercentage, formatDuration, formatRelativeTime } from '@/lib/utils';

interface Column {
  key: string;
  label: string;
  sortable?: boolean;
  format?: 'percentage' | 'duration' | 'time' | 'status';
}

interface DataTableProps {
  title: string;
  description: string;
  dataType: 'oracle_data' | 'health_status';
  columns: Column[];
  pageSize: number;
  enableSearch?: boolean;
  enableFilters?: boolean;
  enableExport?: boolean;
  realTime?: boolean;
}

export function DataTable({
  title,
  description,
  dataType,
  columns,
  pageSize,
  enableSearch = false,
  enableFilters = false,
  enableExport = false,
  realTime = false,
}: DataTableProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [searchTerm, setSearchTerm] = useState('');

  const {
    oracleData,
    healthStatuses,
    isConnected,
  } = useWebSocketStore();

  // Get data based on type
  const rawData = useMemo(() => {
    switch (dataType) {
      case 'oracle_data':
        return Array.from(oracleData.values());
      case 'health_status':
        return Array.from(healthStatuses.values());
      default:
        return [];
    }
  }, [dataType, oracleData, healthStatuses]);

  // Filter and sort data
  const processedData = useMemo(() => {
    let filtered = rawData;

    // Apply search filter
    if (searchTerm && enableSearch) {
      filtered = filtered.filter(item =>
        Object.values(item).some(value =>
          String(value).toLowerCase().includes(searchTerm.toLowerCase())
        )
      );
    }

    // Apply sorting
    if (sortColumn) {
      filtered = [...filtered].sort((a, b) => {
        const aValue = a[sortColumn as keyof typeof a];
        const bValue = b[sortColumn as keyof typeof b];

        if (typeof aValue === 'number' && typeof bValue === 'number') {
          return sortDirection === 'asc' ? aValue - bValue : bValue - aValue;
        }

        const aStr = String(aValue).toLowerCase();
        const bStr = String(bValue).toLowerCase();
        
        if (sortDirection === 'asc') {
          return aStr.localeCompare(bStr);
        } else {
          return bStr.localeCompare(aStr);
        }
      });
    }

    return filtered;
  }, [rawData, searchTerm, sortColumn, sortDirection, enableSearch]);

  // Pagination
  const totalPages = Math.ceil(processedData.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedData = processedData.slice(startIndex, startIndex + pageSize);

  const handleSort = (columnKey: string) => {
    if (sortColumn === columnKey) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(columnKey);
      setSortDirection('asc');
    }
  };

  const formatValue = (value: any, format?: string) => {
    if (value === null || value === undefined) return '-';

    switch (format) {
      case 'percentage':
        return formatPercentage(typeof value === 'number' ? value : parseFloat(value));
      case 'duration':
        return formatDuration(typeof value === 'number' ? value : parseFloat(value));
      case 'time':
        return formatRelativeTime(typeof value === 'number' ? value : new Date(value).getTime());
      case 'status':
        return (
          <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(value)}`}>
            {value}
          </span>
        );
      default:
        return String(value);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'healthy':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      case 'degraded':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
      case 'unhealthy':
      case 'offline':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200';
    }
  };

  return (
    <div className="card p-6">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <h3 className="text-lg font-semibold">{title}</h3>
              {realTime && isConnected && (
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" title="Live data" />
              )}
            </div>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
          
          <div className="flex items-center space-x-2">
            <span className="text-sm text-muted-foreground">
              {processedData.length} items
            </span>
            {enableExport && (
              <button className="px-3 py-1 text-sm border rounded hover:bg-muted transition-colors">
                Export
              </button>
            )}
          </div>
        </div>

        {/* Search */}
        {enableSearch && (
          <div className="flex items-center space-x-2">
            <div className="relative flex-1 max-w-sm">
              <svg
                className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>
        )}

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                {columns.map((column) => (
                  <th
                    key={column.key}
                    className={`px-4 py-3 text-left text-sm font-medium text-muted-foreground ${
                      column.sortable ? 'cursor-pointer hover:text-foreground' : ''
                    }`}
                    onClick={() => column.sortable && handleSort(column.key)}
                  >
                    <div className="flex items-center space-x-1">
                      <span>{column.label}</span>
                      {column.sortable && (
                        <svg
                          className={`w-4 h-4 ${
                            sortColumn === column.key
                              ? 'text-foreground'
                              : 'text-muted-foreground'
                          }`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d={
                              sortColumn === column.key && sortDirection === 'desc'
                                ? "M5 15l7-7 7 7"
                                : "M19 9l-7 7-7-7"
                            }
                          />
                        </svg>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginatedData.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-8 text-center text-muted-foreground">
                    No data available
                  </td>
                </tr>
              ) : (
                paginatedData.map((row, index) => (
                  <tr key={index} className="border-b hover:bg-muted/50 transition-colors">
                    {columns.map((column) => (
                      <td key={column.key} className="px-4 py-3 text-sm">
                        {formatValue(row[column.key as keyof typeof row], column.format)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              Showing {startIndex + 1} to {Math.min(startIndex + pageSize, processedData.length)} of {processedData.length} results
            </div>
            
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1 text-sm border rounded hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              
              <span className="text-sm">
                Page {currentPage} of {totalPages}
              </span>
              
              <button
                onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-1 text-sm border rounded hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
