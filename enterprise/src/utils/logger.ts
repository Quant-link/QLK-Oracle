/**
 * @fileoverview Enterprise Logger with structured logging
 * @author QuantLink Team
 * @version 1.0.0
 */

import winston from 'winston';
import { ElasticsearchTransport } from 'winston-elasticsearch';

export interface LogContext {
  requestId?: string;
  userId?: string;
  organizationId?: string;
  action?: string;
  resource?: string;
  [key: string]: any;
}

export class Logger {
  private logger: winston.Logger;
  private context: string;

  constructor(context: string) {
    this.context = context;
    this.logger = this.createLogger();
  }

  private createLogger(): winston.Logger {
    const transports: winston.transport[] = [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.timestamp(),
          winston.format.printf(({ timestamp, level, message, context, ...meta }) => {
            const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
            return `${timestamp} [${level}] [${context}] ${message} ${metaStr}`;
          })
        ),
      }),
    ];

    // Add file transport for production
    if (process.env.NODE_ENV === 'production') {
      transports.push(
        new winston.transports.File({
          filename: 'logs/error.log',
          level: 'error',
          format: winston.format.json(),
        }),
        new winston.transports.File({
          filename: 'logs/combined.log',
          format: winston.format.json(),
        })
      );

      // Add Elasticsearch transport if configured
      if (process.env.ELASTICSEARCH_URL) {
        transports.push(
          new ElasticsearchTransport({
            level: 'info',
            clientOpts: {
              node: process.env.ELASTICSEARCH_URL,
            },
            index: 'quantlink-logs',
          })
        );
      }
    }

    return winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      defaultMeta: { context: this.context },
      transports,
    });
  }

  info(message: string, context?: LogContext): void {
    this.logger.info(message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.logger.warn(message, context);
  }

  error(message: string, context?: LogContext): void {
    this.logger.error(message, context);
  }

  debug(message: string, context?: LogContext): void {
    this.logger.debug(message, context);
  }

  audit(action: string, resource: string, context?: LogContext): void {
    this.logger.info('AUDIT', {
      ...context,
      action,
      resource,
      type: 'audit',
    });
  }
}
