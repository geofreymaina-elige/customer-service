import { Injectable } from '@nestjs/common';
import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

export interface SasaPayLogEntry {
  timestamp: string;
  operation: string;
  method?: string;
  url?: string;
  statusCode?: number;
  requestPayload?: unknown;
  responsePayload?: unknown;
  error?: unknown;
  customerId?: number;
  applicationId?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Dedicated logger for SasaPay API interactions
 * Logs all requests, responses, callbacks, and errors to a separate file
 */
@Injectable()
export class SasaPayLogger {
  private readonly logDir: string;
  private readonly logFile: string;

  constructor() {
    // Store logs in logs/sasapay directory
    this.logDir = join(process.cwd(), 'logs', 'sasapay');
    this.ensureLogDirectory();
    
    // Create date-based log file (e.g., sasapay-2026-10-05.jsonl)
    const dateStr = new Date().toISOString().split('T')[0];
    this.logFile = join(this.logDir, `sasapay-${dateStr}.jsonl`);
  }

  private ensureLogDirectory(): void {
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * Log an outgoing API request to SasaPay
   */
  logRequest(operation: string, method: string, url: string, payload?: unknown, metadata?: Record<string, unknown>): void {
    const entry: SasaPayLogEntry = {
      timestamp: new Date().toISOString(),
      operation,
      method,
      url,
      requestPayload: this.sanitizePayload(payload),
      metadata,
    };

    this.writeLog(entry);
    console.log(`[SASAPAY-API] → ${method} ${url} [${operation}]`);
  }

  /**
   * Log an API response from SasaPay
   */
  logResponse(operation: string, url: string, statusCode: number, response?: unknown, metadata?: Record<string, unknown>): void {
    const entry: SasaPayLogEntry = {
      timestamp: new Date().toISOString(),
      operation,
      url,
      statusCode,
      responsePayload: this.sanitizePayload(response),
      metadata,
    };

    this.writeLog(entry);
    console.log(`[SASAPAY-API] ← ${statusCode} ${url} [${operation}]`);
  }

  /**
   * Log an incoming callback from SasaPay
   */
  logCallback(callbackPayload: unknown, customerId?: number, applicationId?: number, metadata?: Record<string, unknown>): void {
    const entry: SasaPayLogEntry = {
      timestamp: new Date().toISOString(),
      operation: 'CALLBACK_RECEIVED',
      customerId,
      applicationId,
      responsePayload: this.sanitizePayload(callbackPayload),
      metadata,
    };

    this.writeLog(entry);
    console.log(`[SASAPAY-CALLBACK] Received callback for customer ${customerId}`);
  }

  /**
   * Log a KYC image upload operation
   */
  logImageUpload(
    customerId: number,
    applicationId: number,
    submissionId: string,
    documentTypes: string[],
    statusCode?: number,
    response?: unknown,
    error?: unknown,
  ): void {
    const entry: SasaPayLogEntry = {
      timestamp: new Date().toISOString(),
      operation: 'KYC_IMAGE_UPLOAD',
      customerId,
      applicationId,
      statusCode,
      responsePayload: this.sanitizePayload(response),
      error: error ? this.sanitizePayload(error) : undefined,
      metadata: {
        submissionId,
        documentTypes,
      },
    };

    this.writeLog(entry);
    if (error) {
      console.error(`[SASAPAY-KYC] Image upload failed for customer ${customerId}:`, error);
    } else {
      console.log(`[SASAPAY-KYC] Image upload completed for customer ${customerId} [${statusCode}]`);
    }
  }

  /**
   * Log an error during SasaPay operations
   */
  logError(operation: string, error: unknown, metadata?: Record<string, unknown>): void {
    const entry: SasaPayLogEntry = {
      timestamp: new Date().toISOString(),
      operation,
      error: this.extractErrorInfo(error),
      statusCode: this.extractStatusCode(error),
      metadata,
    };

    this.writeLog(entry);
    console.error(`[SASAPAY-ERROR] ${operation}:`, error);
  }

  /**
   * Sanitize sensitive data from payloads
   */
  private sanitizePayload(payload: unknown): unknown {
    if (!payload) return payload;

    try {
      const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
      const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;

      if (typeof parsed === 'object' && parsed !== null) {
        const sanitized = { ...parsed };

        // Redact sensitive fields
        const sensitiveFields = [
          'password',
          'token',
          'access_token',
          'accessToken',
          'Authorization',
          'client_secret',
          'clientSecret',
          'otp',
          'confirmationCode',
        ];

        for (const field of sensitiveFields) {
          if (field in sanitized) {
            sanitized[field] = '[REDACTED]';
          }
        }

        return sanitized;
      }

      return parsed;
    } catch {
      // If we can't parse it, return as-is
      return payload;
    }
  }

  /**
   * Extract error information for logging
   */
  private extractErrorInfo(error: unknown): unknown {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
        // Include axios error details if present
        ...(error as any).response?.data && { responseData: (error as any).response.data },
        ...(error as any).config?.url && { url: (error as any).config.url },
        ...(error as any).config?.method && { method: (error as any).config.method },
      };
    }

    return error;
  }

  /**
   * Extract HTTP status code from error if available
   */
  private extractStatusCode(error: unknown): number | undefined {
    if (error && typeof error === 'object' && 'response' in error) {
      const response = (error as any).response;
      if (response && 'status' in response) {
        return response.status;
      }
    }
    return undefined;
  }

  /**
   * Write log entry to file as JSON Lines format
   */
  private writeLog(entry: SasaPayLogEntry): void {
    try {
      const logLine = JSON.stringify(entry) + '\n';
      appendFileSync(this.logFile, logLine, 'utf8');
    } catch (error) {
      console.error('[SASAPAY-LOGGER] Failed to write log:', error);
    }
  }
}
