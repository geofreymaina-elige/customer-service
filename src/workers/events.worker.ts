import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { DatabaseService } from '../core/database/database.service';
import { EventService } from '../core/events/event.service';

@Injectable()
export class EventsWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventsWorker.name);
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: DatabaseService,
    private readonly eventService: EventService,
  ) {}

  onModuleInit() {
    this.isRunning = true;
    this.logger.log('[EVENTS WORKER] Initialized outbox event dispatcher worker');
    this.pollLoop();
  }

  onModuleDestroy() {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
    }
  }

  private async pollLoop() {
    if (!this.isRunning) return;

    try {
      // Find unprocessed events from the last 1 hour
      const events = await this.db.query(
        `SELECT id, uuid, event_type, aggregate_type, aggregate_id, payload
         FROM events
         WHERE created_at >= NOW() - INTERVAL '1 hour'
         ORDER BY created_at ASC
         LIMIT 20`
      );

      for (const event of events.rows) {
        await this.eventService.dispatchEventIdempotently(event.id, 'CentralAuditLogger', async () => {
          this.logger.log(`[AUDIT EVENT DISPATCH] ${event.event_type} (${event.uuid}) on ${event.aggregate_type}`);
        });
      }
    } catch (error) {
      this.logger.error(`[EVENTS WORKER] Error in event loop: ${error?.message}`);
    }

    if (this.isRunning) {
      this.timer = setTimeout(() => this.pollLoop(), 5000); // Poll every 5s
    }
  }
}
