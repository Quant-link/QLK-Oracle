/**
 * @fileoverview Real-time Chart component with WebSocket data
 * @author QuantLink Team
 * @version 1.0.0
 */

'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useWebSocketStore } from '@/lib/store/websocket-store';

interface RealTimeChartProps {
  title: string;
  description: string;
  dataType: 'cex_fees' | 'dex_fees' | 'price_data';
  symbol: string;
  height: number;
  showLegend?: boolean;
  showTooltip?: boolean;
  enableZoom?: boolean;
  enablePan?: boolean;
  showVolume?: boolean;
}

export function RealTimeChart({
  title,
  description,
  dataType,
  symbol,
  height,
  showLegend = false,
  showTooltip = false,
  enableZoom = false,
  enablePan = false,
  showVolume = false,
}: RealTimeChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  const {
    oracleData,
    priceData,
    feeData,
    isConnected,
  } = useWebSocketStore();

  // Get data based on type
  const getData = () => {
    switch (dataType) {
      case 'cex_fees':
        return feeData.get(symbol)?.filter(d => d.exchangeType === 'CEX') || [];
      case 'dex_fees':
        return feeData.get(symbol)?.filter(d => d.exchangeType === 'DEX') || [];
      case 'price_data':
        return priceData.get(symbol) || [];
      default:
        return [];
    }
  };

  const data = getData();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    canvas.width = canvas.offsetWidth * window.devicePixelRatio;
    canvas.height = height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    // Clear canvas
    ctx.clearRect(0, 0, canvas.offsetWidth, height);

    // Draw chart background
    ctx.fillStyle = 'hsl(var(--muted))';
    ctx.fillRect(0, 0, canvas.offsetWidth, height);

    if (data.length === 0) {
      // Draw "No Data" message
      ctx.fillStyle = 'hsl(var(--muted-foreground))';
      ctx.font = '14px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No data available', canvas.offsetWidth / 2, height / 2);
      setIsLoading(false);
      return;
    }

    // Draw simple line chart
    const padding = 40;
    const chartWidth = canvas.offsetWidth - padding * 2;
    const chartHeight = height - padding * 2;

    // Get min/max values
    const values = data.map(d => {
      switch (dataType) {
        case 'cex_fees':
        case 'dex_fees':
          return d.makerFee;
        case 'price_data':
          return d.price;
        default:
          return 0;
      }
    });

    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const valueRange = maxValue - minValue || 1;

    // Draw grid lines
    ctx.strokeStyle = 'hsl(var(--border))';
    ctx.lineWidth = 1;
    
    // Horizontal grid lines
    for (let i = 0; i <= 5; i++) {
      const y = padding + (chartHeight / 5) * i;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(padding + chartWidth, y);
      ctx.stroke();
    }

    // Vertical grid lines
    for (let i = 0; i <= 10; i++) {
      const x = padding + (chartWidth / 10) * i;
      ctx.beginPath();
      ctx.moveTo(x, padding);
      ctx.lineTo(x, padding + chartHeight);
      ctx.stroke();
    }

    // Draw data line
    if (data.length > 1) {
      ctx.strokeStyle = 'hsl(var(--primary))';
      ctx.lineWidth = 2;
      ctx.beginPath();

      data.forEach((point, index) => {
        const x = padding + (chartWidth / (data.length - 1)) * index;
        const value = values[index];
        const y = padding + chartHeight - ((value - minValue) / valueRange) * chartHeight;

        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });

      ctx.stroke();

      // Draw data points
      ctx.fillStyle = 'hsl(var(--primary))';
      data.forEach((point, index) => {
        const x = padding + (chartWidth / (data.length - 1)) * index;
        const value = values[index];
        const y = padding + chartHeight - ((value - minValue) / valueRange) * chartHeight;

        ctx.beginPath();
        ctx.arc(x, y, 3, 0, 2 * Math.PI);
        ctx.fill();
      });
    }

    // Draw axes labels
    ctx.fillStyle = 'hsl(var(--foreground))';
    ctx.font = '12px Inter, sans-serif';
    ctx.textAlign = 'center';

    // Y-axis labels
    for (let i = 0; i <= 5; i++) {
      const value = minValue + (valueRange / 5) * (5 - i);
      const y = padding + (chartHeight / 5) * i;
      ctx.textAlign = 'right';
      ctx.fillText(value.toFixed(4), padding - 10, y + 4);
    }

    // X-axis labels (timestamps)
    const labelCount = Math.min(5, data.length);
    for (let i = 0; i < labelCount; i++) {
      const dataIndex = Math.floor((data.length - 1) * (i / (labelCount - 1)));
      const point = data[dataIndex];
      const x = padding + (chartWidth / (data.length - 1)) * dataIndex;
      
      ctx.textAlign = 'center';
      const time = new Date(point.timestamp).toLocaleTimeString();
      ctx.fillText(time, x, height - 10);
    }

    setIsLoading(false);
  }, [data, height, dataType]);

  return (
    <div className="card p-6">
      <div className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">{title}</h3>
            <div className="flex items-center space-x-2">
              {isConnected ? (
                <div className="w-2 h-2 bg-green-500 rounded-full" title="Live data" />
              ) : (
                <div className="w-2 h-2 bg-red-500 rounded-full" title="Disconnected" />
              )}
              <span className="text-xs text-muted-foreground">
                {data.length} points
              </span>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        
        <div className="relative">
          <canvas
            ref={canvasRef}
            className="w-full border rounded"
            style={{ height: `${height}px` }}
            aria-label={`${title} chart showing ${dataType} data for ${symbol}`}
          />
          
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/80">
              <div className="flex items-center space-x-2">
                <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <span className="text-sm text-muted-foreground">Loading chart...</span>
              </div>
            </div>
          )}
        </div>

        {showLegend && (
          <div className="flex items-center space-x-4 text-sm">
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 bg-primary rounded-full" />
              <span>{dataType.replace('_', ' ').toUpperCase()}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
