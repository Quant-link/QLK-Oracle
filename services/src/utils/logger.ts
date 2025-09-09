/**
 * @fileoverview Production-ready logger with structured logging and multiple transports
 * @author QuantLink Team
 * @version 1.0.0
 */

import winston from 'winston';
import { serviceConfig } from '@/config';

export interface LogContext {
  [key: string]: any;
}

export class Logger {
  private winston: winston.Logger;
  private context: string;

  constructor(context: string = 'App') {
    this.context = context;
    this.winston = winston.createLogger({
      level: serviceConfig.logLevel,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json(),
        winston.format.printf(({ timestamp, level, message, context, ...meta }) => {
          return JSON.stringify({
            timestamp,
            level,
            context: context || this.context,
            message,
            ...meta,
          });
        })
      ),
      defaultMeta: { context: this.context },
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          ),
        }),
        new winston.transports.File({
          filename: 'logs/error.log',
          level: 'error',
          maxsize: 10 * 1024 * 1024, // 10MB
          maxFiles: 5,
        }),
        new winston.transports.File({
          filename: 'logs/combined.log',
          maxsize: 10 * 1024 * 1024, // 10MB
          maxFiles: 10,
        }),
      ],
    });

    // Add production-specific transports
    if (serviceConfig.environment === 'production') {
      // Add external logging service transport here
      // Example: Elasticsearch, Splunk, etc.
    }
  }

  debug(message: string, context?: LogContext): void {
    this.winston.debug(message, context);
  }

  info(message: string, context?: LogContext): void {
    this.winston.info(message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.winston.warn(message, context);
  }

  error(message: string, context?: LogContext): void {
    this.winston.error(message, context);
  }

  fatal(message: string, context?: LogContext): void {
    this.winston.error(message, { ...context, fatal: true });
  }
}
