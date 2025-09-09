/**
 * @fileoverview Enterprise Data Export & Reporting Manager
 * @author QuantLink Team
 * @version 1.0.0
 */

import { Router, Request, Response } from 'express';
import { Kafka, Producer, Consumer } from 'kafkajs';
import cron from 'cron';
import csv from 'csv-parser';
import { Parser as Json2CsvParser } from 'json2csv';
import * as XLSX from 'xlsx';
import { PDFDocument, rgb } from 'pdf-lib';
import nodemailer from 'nodemailer';

import { Logger } from '../utils/logger';
import { MetricsCollector } from '../monitoring/metrics';
import { DatabaseService } from '../database/database-service';
import { RedisService } from '../cache/redis-service';
import { 
  ReportTemplate, 
  DataExportRequest, 
  KafkaConfig,
  ReportParameter,
  CronSchedule 
} from '../types';

export interface ReportConfig {
  kafka: KafkaConfig;
  storage: {
    path: string;
    maxFileSize: number;
    retentionDays: number;
  };
  email: {
    host: string;
    port: number;
    secure: boolean;
    auth: {
      user: string;
      pass: string;
    };
  };
  limits: {
    maxRowsPerExport: number;
    maxConcurrentExports: number;
    exportTimeoutMs: number;
  };
}

export class ReportManager {
  public router: Router;
  private logger: Logger;
  private metrics: MetricsCollector;
  private database: DatabaseService;
  private redis: RedisService;
  private kafka: Kafka;
  private producer: Producer;
  private consumer: Consumer;
  private config: ReportConfig;
  private scheduledJobs: Map<string, cron.CronJob> = new Map();
  private activeExports: Set<string> = new Set();

  constructor(config: ReportConfig) {
    this.config = config;
    this.router = Router();
    this.logger = new Logger('ReportManager');
    this.metrics = new MetricsCollector('reporting');
    this.database = new DatabaseService();
    this.redis = new RedisService();
    
    this.initializeKafka();
    this.setupRoutes();
    this.loadScheduledReports();
  }

  /**
   * Initialize Kafka for real-time data streaming
   */
  private async initializeKafka(): Promise<void> {
    try {
      this.kafka = new Kafka({
        clientId: this.config.kafka.clientId,
        brokers: this.config.kafka.brokers,
        ssl: this.config.kafka.ssl,
        sasl: this.config.kafka.sasl,
      });

      this.producer = this.kafka.producer({
        maxInFlightRequests: 1,
        idempotent: true,
        transactionTimeout: 30000,
      });

      this.consumer = this.kafka.consumer({
        groupId: this.config.kafka.groupId,
        sessionTimeout: 30000,
        heartbeatInterval: 3000,
      });

      await this.producer.connect();
      await this.consumer.connect();

      // Subscribe to data topics
      await this.consumer.subscribe({
        topics: this.config.kafka.topics,
        fromBeginning: false,
      });

      // Start consuming messages
      await this.consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
          await this.handleKafkaMessage(topic, partition, message);
        },
      });

      this.logger.info('Kafka initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Kafka', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Setup reporting routes
   */
  private setupRoutes(): void {
    // Report templates
    this.router.post('/templates', this.createReportTemplate.bind(this));
    this.router.get('/templates', this.listReportTemplates.bind(this));
    this.router.get('/templates/:templateId', this.getReportTemplate.bind(this));
    this.router.put('/templates/:templateId', this.updateReportTemplate.bind(this));
    this.router.delete('/templates/:templateId', this.deleteReportTemplate.bind(this));

    // Data exports
    this.router.post('/exports', this.createDataExport.bind(this));
    this.router.get('/exports', this.listDataExports.bind(this));
    this.router.get('/exports/:exportId', this.getDataExport.bind(this));
    this.router.get('/exports/:exportId/download', this.downloadExport.bind(this));
    this.router.delete('/exports/:exportId', this.deleteDataExport.bind(this));

    // Real-time streaming
    this.router.post('/streams', this.createDataStream.bind(this));
    this.router.get('/streams', this.listDataStreams.bind(this));
    this.router.delete('/streams/:streamId', this.deleteDataStream.bind(this));

    // Report generation
    this.router.post('/generate', this.generateReport.bind(this));
    this.router.post('/templates/:templateId/generate', this.generateFromTemplate.bind(this));

    // Scheduled reports
    this.router.get('/scheduled', this.listScheduledReports.bind(this));
    this.router.post('/scheduled/:templateId/run', this.runScheduledReport.bind(this));
  }

  /**
   * Create report template
   */
  private async createReportTemplate(req: Request, res: Response): Promise<void> {
    try {
      const {
        name,
        description,
        type,
        format,
        query,
        parameters,
        schedule,
        recipients,
      } = req.body;

      // Validate required fields
      if (!name || !query || !format) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Name, query, and format are required',
          },
        });
      }

      // Validate query syntax
      const queryValidation = await this.validateQuery(query);
      if (!queryValidation.isValid) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_QUERY',
            message: queryValidation.error,
          },
        });
      }

      const template: Omit<ReportTemplate, 'id' | 'createdAt' | 'updatedAt'> = {
        name,
        description,
        type: type || 'on-demand',
        format,
        query,
        parameters: parameters || [],
        schedule,
        recipients: recipients || [],
        organizationId: (req as any).user.organizationId,
        isActive: true,
      };

      const createdTemplate = await this.database.createReportTemplate(template);

      // Schedule if it's a scheduled report
      if (template.type === 'scheduled' && schedule) {
        await this.scheduleReport(createdTemplate);
      }

      this.logger.info('Report template created', {
        templateId: createdTemplate.id,
        name,
        type,
      });

      this.metrics.incrementCounter('report_templates_created');

      res.status(201).json({
        success: true,
        data: createdTemplate,
      });
    } catch (error) {
      this.logger.error('Failed to create report template', {
        error: error instanceof Error ? error.message : String(error),
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'CREATION_ERROR',
          message: 'Failed to create report template',
        },
      });
    }
  }

  /**
   * Create data export request
   */
  private async createDataExport(req: Request, res: Response): Promise<void> {
    try {
      const {
        type,
        format,
        filters,
        dateRange,
        query,
      } = req.body;

      // Check concurrent export limit
      if (this.activeExports.size >= this.config.limits.maxConcurrentExports) {
        return res.status(429).json({
          success: false,
          error: {
            code: 'EXPORT_LIMIT_EXCEEDED',
            message: 'Maximum concurrent exports reached',
          },
        });
      }

      const exportRequest: Omit<DataExportRequest, 'id' | 'createdAt' | 'updatedAt'> = {
        userId: (req as any).user.id,
        organizationId: (req as any).user.organizationId,
        type: type || 'historical',
        format: format || 'CSV',
        filters: filters || {},
        dateRange: dateRange || {
          start: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
          end: new Date(),
        },
        status: 'pending',
      };

      const createdExport = await this.database.createDataExportRequest(exportRequest);

      // Start export processing asynchronously
      this.processDataExport(createdExport).catch(error => {
        this.logger.error('Export processing failed', {
          exportId: createdExport.id,
          error: error.message,
        });
      });

      this.logger.info('Data export request created', {
        exportId: createdExport.id,
        type,
        format,
      });

      this.metrics.incrementCounter('data_exports_created');

      res.status(201).json({
        success: true,
        data: createdExport,
      });
    } catch (error) {
      this.logger.error('Failed to create data export', {
        error: error instanceof Error ? error.message : String(error),
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'EXPORT_ERROR',
          message: 'Failed to create data export',
        },
      });
    }
  }

  /**
   * Generate report from template
   */
  private async generateFromTemplate(req: Request, res: Response): Promise<void> {
    try {
      const { templateId } = req.params;
      const { parameters } = req.body;

      const template = await this.database.getReportTemplate(templateId);
      
      if (!template) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'TEMPLATE_NOT_FOUND',
            message: 'Report template not found',
          },
        });
      }

      // Validate parameters
      const paramValidation = this.validateParameters(template.parameters, parameters);
      if (!paramValidation.isValid) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_PARAMETERS',
            message: paramValidation.error,
          },
        });
      }

      // Generate report
      const reportData = await this.executeQuery(template.query, parameters);
      const reportFile = await this.formatReport(reportData, template.format);

      // Store report file
      const downloadUrl = await this.storeReportFile(reportFile, template.format);

      this.logger.info('Report generated from template', {
        templateId,
        format: template.format,
      });

      this.metrics.incrementCounter('reports_generated');

      res.json({
        success: true,
        data: {
          downloadUrl,
          format: template.format,
          generatedAt: new Date(),
          rowCount: reportData.length,
        },
      });
    } catch (error) {
      this.logger.error('Failed to generate report from template', {
        templateId: req.params.templateId,
        error: error instanceof Error ? error.message : String(error),
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'GENERATION_ERROR',
          message: 'Failed to generate report',
        },
      });
    }
  }

  /**
   * Process data export request
   */
  private async processDataExport(exportRequest: DataExportRequest): Promise<void> {
    const exportId = exportRequest.id;
    
    try {
      this.activeExports.add(exportId);
      
      // Update status to processing
      await this.database.updateDataExportRequest(exportId, {
        status: 'processing',
      });

      // Execute data query
      const data = await this.executeDataQuery(exportRequest);

      // Check row limit
      if (data.length > this.config.limits.maxRowsPerExport) {
        throw new Error(`Export exceeds maximum row limit of ${this.config.limits.maxRowsPerExport}`);
      }

      // Format data based on requested format
      const formattedData = await this.formatExportData(data, exportRequest.format);

      // Store file and get download URL
      const downloadUrl = await this.storeExportFile(formattedData, exportRequest.format, exportId);

      // Calculate expiration date (7 days from now)
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      // Update export request with completion
      await this.database.updateDataExportRequest(exportId, {
        status: 'completed',
        downloadUrl,
        expiresAt,
      });

      this.logger.info('Data export completed', {
        exportId,
        rowCount: data.length,
        format: exportRequest.format,
      });

      this.metrics.incrementCounter('data_exports_completed');
      this.metrics.recordGauge('export_rows_processed', data.length);

    } catch (error) {
      // Update status to failed
      await this.database.updateDataExportRequest(exportId, {
        status: 'failed',
      });

      this.logger.error('Data export failed', {
        exportId,
        error: error instanceof Error ? error.message : String(error),
      });

      this.metrics.incrementCounter('data_exports_failed');
      
      throw error;
    } finally {
      this.activeExports.delete(exportId);
    }
  }

  /**
   * Format export data based on format
   */
  private async formatExportData(data: any[], format: string): Promise<Buffer> {
    switch (format.toUpperCase()) {
      case 'CSV':
        return this.formatAsCSV(data);
      case 'JSON':
        return this.formatAsJSON(data);
      case 'XLSX':
        return this.formatAsXLSX(data);
      case 'PDF':
        return this.formatAsPDF(data);
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  /**
   * Format data as CSV
   */
  private formatAsCSV(data: any[]): Buffer {
    if (data.length === 0) {
      return Buffer.from('');
    }

    const parser = new Json2CsvParser({
      fields: Object.keys(data[0]),
    });

    const csv = parser.parse(data);
    return Buffer.from(csv, 'utf8');
  }

  /**
   * Format data as JSON
   */
  private formatAsJSON(data: any[]): Buffer {
    return Buffer.from(JSON.stringify(data, null, 2), 'utf8');
  }

  /**
   * Format data as XLSX
   */
  private formatAsXLSX(data: any[]): Buffer {
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Data');
    
    return Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
  }

  /**
   * Format data as PDF
   */
  private async formatAsPDF(data: any[]): Promise<Buffer> {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage();
    const { width, height } = page.getSize();
    
    // Add title
    page.drawText('QuantLink Data Export', {
      x: 50,
      y: height - 50,
      size: 20,
      color: rgb(0, 0, 0),
    });

    // Add timestamp
    page.drawText(`Generated: ${new Date().toISOString()}`, {
      x: 50,
      y: height - 80,
      size: 12,
      color: rgb(0.5, 0.5, 0.5),
    });

    // Add data summary
    page.drawText(`Total Records: ${data.length}`, {
      x: 50,
      y: height - 110,
      size: 12,
      color: rgb(0, 0, 0),
    });

    // For large datasets, we'd implement pagination and table formatting
    // This is a simplified version
    let yPosition = height - 150;
    const maxRows = Math.min(data.length, 20); // Limit to first 20 rows for PDF

    for (let i = 0; i < maxRows; i++) {
      const row = data[i];
      const rowText = JSON.stringify(row).substring(0, 80) + '...';
      
      page.drawText(rowText, {
        x: 50,
        y: yPosition,
        size: 8,
        color: rgb(0, 0, 0),
      });
      
      yPosition -= 15;
      
      if (yPosition < 50) break; // Avoid going off page
    }

    if (data.length > maxRows) {
      page.drawText(`... and ${data.length - maxRows} more records`, {
        x: 50,
        y: yPosition - 20,
        size: 10,
        color: rgb(0.5, 0.5, 0.5),
      });
    }

    return Buffer.from(await pdfDoc.save());
  }

  /**
   * Store export file and return download URL
   */
  private async storeExportFile(data: Buffer, format: string, exportId: string): Promise<string> {
    const fileName = `export_${exportId}.${format.toLowerCase()}`;
    const filePath = `${this.config.storage.path}/${fileName}`;
    
    // In a real implementation, this would store to cloud storage (S3, GCS, etc.)
    // For now, we'll simulate with a URL
    const downloadUrl = `/api/v1/reports/exports/${exportId}/download`;
    
    // Store file metadata in Redis for quick access
    await this.redis.setex(`export_file:${exportId}`, 
      this.config.storage.retentionDays * 24 * 60 * 60, 
      JSON.stringify({
        fileName,
        filePath,
        size: data.length,
        format,
        createdAt: new Date(),
      })
    );

    return downloadUrl;
  }

  /**
   * Handle Kafka message for real-time streaming
   */
  private async handleKafkaMessage(topic: string, partition: number, message: any): Promise<void> {
    try {
      const data = JSON.parse(message.value?.toString() || '{}');
      
      // Process real-time data for active streams
      await this.processRealTimeData(topic, data);
      
      this.metrics.incrementCounter('kafka_messages_processed', { topic });
    } catch (error) {
      this.logger.error('Failed to handle Kafka message', {
        topic,
        partition,
        error: error instanceof Error ? error.message : String(error),
      });
      
      this.metrics.incrementCounter('kafka_message_errors', { topic });
    }
  }

  /**
   * Load and schedule existing report templates
   */
  private async loadScheduledReports(): Promise<void> {
    try {
      const scheduledTemplates = await this.database.getScheduledReportTemplates();
      
      for (const template of scheduledTemplates) {
        if (template.schedule && template.isActive) {
          await this.scheduleReport(template);
        }
      }
      
      this.logger.info('Scheduled reports loaded', { 
        count: scheduledTemplates.length 
      });
    } catch (error) {
      this.logger.error('Failed to load scheduled reports', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Schedule a report template
   */
  private async scheduleReport(template: ReportTemplate): Promise<void> {
    if (!template.schedule) return;

    const job = new cron.CronJob(
      template.schedule.expression,
      async () => {
        try {
          await this.executeScheduledReport(template);
        } catch (error) {
          this.logger.error('Scheduled report execution failed', {
            templateId: template.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
      null,
      template.schedule.enabled,
      template.schedule.timezone
    );

    this.scheduledJobs.set(template.id, job);
    
    this.logger.info('Report scheduled', {
      templateId: template.id,
      schedule: template.schedule.expression,
    });
  }

  /**
   * Execute scheduled report
   */
  private async executeScheduledReport(template: ReportTemplate): Promise<void> {
    try {
      this.logger.info('Executing scheduled report', { templateId: template.id });
      
      // Generate report
      const reportData = await this.executeQuery(template.query, {});
      const reportFile = await this.formatReport(reportData, template.format);
      
      // Store report
      const downloadUrl = await this.storeReportFile(reportFile, template.format);
      
      // Send to recipients
      if (template.recipients.length > 0) {
        await this.sendReportToRecipients(template, downloadUrl, reportData.length);
      }
      
      this.metrics.incrementCounter('scheduled_reports_executed');
      
      this.logger.info('Scheduled report completed', {
        templateId: template.id,
        rowCount: reportData.length,
      });
    } catch (error) {
      this.metrics.incrementCounter('scheduled_reports_failed');
      throw error;
    }
  }

  // Additional helper methods would be implemented here...
  private async validateQuery(query: string): Promise<{ isValid: boolean; error?: string }> {
    // Implementation for query validation
    return { isValid: true };
  }

  private validateParameters(templateParams: ReportParameter[], providedParams: any): { isValid: boolean; error?: string } {
    // Implementation for parameter validation
    return { isValid: true };
  }

  private async executeQuery(query: string, parameters: any): Promise<any[]> {
    // Implementation for executing database queries
    return [];
  }

  private async executeDataQuery(exportRequest: DataExportRequest): Promise<any[]> {
    // Implementation for executing data export queries
    return [];
  }

  private async formatReport(data: any[], format: string): Promise<Buffer> {
    // Implementation for formatting reports
    return Buffer.from('');
  }

  private async storeReportFile(data: Buffer, format: string): Promise<string> {
    // Implementation for storing report files
    return '';
  }

  private async processRealTimeData(topic: string, data: any): Promise<void> {
    // Implementation for processing real-time data
  }

  private async sendReportToRecipients(template: ReportTemplate, downloadUrl: string, rowCount: number): Promise<void> {
    // Implementation for sending reports via email
  }

  // Route handlers for the remaining endpoints...
  private async listReportTemplates(req: Request, res: Response): Promise<void> {
    // Implementation
  }

  private async getReportTemplate(req: Request, res: Response): Promise<void> {
    // Implementation
  }

  private async updateReportTemplate(req: Request, res: Response): Promise<void> {
    // Implementation
  }

  private async deleteReportTemplate(req: Request, res: Response): Promise<void> {
    // Implementation
  }

  private async listDataExports(req: Request, res: Response): Promise<void> {
    // Implementation
  }

  private async getDataExport(req: Request, res: Response): Promise<void> {
    // Implementation
  }

  private async downloadExport(req: Request, res: Response): Promise<void> {
    // Implementation
  }

  private async deleteDataExport(req: Request, res: Response): Promise<void> {
    // Implementation
  }

  private async createDataStream(req: Request, res: Response): Promise<void> {
    // Implementation
  }

  private async listDataStreams(req: Request, res: Response): Promise<void> {
    // Implementation
  }

  private async deleteDataStream(req: Request, res: Response): Promise<void> {
    // Implementation
  }

  private async generateReport(req: Request, res: Response): Promise<void> {
    // Implementation
  }

  private async listScheduledReports(req: Request, res: Response): Promise<void> {
    // Implementation
  }

  private async runScheduledReport(req: Request, res: Response): Promise<void> {
    // Implementation
  }
}
