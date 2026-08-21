import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface TelemetryEvent {
  name: string;
  properties?: Record<string, any>;
  customerUuid?: string;
  error?: Error;
}

@Injectable()
export class TelemetryService {
  private readonly isEnabled: boolean;
  private readonly logger = new Logger(TelemetryService.name);

  constructor(private readonly config: ConfigService) {
    this.isEnabled = this.config.get<boolean>('SENTRY_ENABLED') ?? false;
    if (this.isEnabled) {
      this.logger.log('Sentry Telemetry initialized');
    }
  }

  captureException(error: Error, context?: Record<string, any>) {
    if (this.isEnabled) {
      // In production with @sentry/node:
      // Sentry.captureException(error, { extra: context });
    }
    this.logger.error(`[TELEMETRY] ${error.message}`, error.stack, context ? JSON.stringify(context) : '');
  }

  captureEvent(event: TelemetryEvent) {
    if (this.isEnabled) {
      // Sentry.captureMessage(event.name, { extra: event.properties });
    }
    this.logger.log(`[EVENT] ${event.name} - ${JSON.stringify(event.properties || {})}`);
  }
}
