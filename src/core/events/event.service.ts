import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export type EventHandler = (event: {
  id: number;
  uuid: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: any;
}) => Promise<void>;

@Injectable()
export class EventService {
  private readonly logger = new Logger(EventService.name);
  private readonly handlers: Map<string, EventHandler[]> = new Map();

  constructor(private readonly db: DatabaseService) {}

  /**
   * Register an idempotent handler for an event type
   */
  subscribe(eventType: string, handler: EventHandler) {
    const existing = this.handlers.get(eventType) || [];
    existing.push(handler);
    this.handlers.set(eventType, existing);
  }

  /**
   * Publish a durable event inside a database transaction or standalone
   */
  async publish(eventType: string, aggregateType: string, aggregateId: string, payload: Record<string, any>): Promise<string> {
    const event = await this.db.queryOne(
      `INSERT INTO events (event_type, aggregate_type, aggregate_id, payload, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING id, uuid`,
      [eventType, aggregateType, aggregateId, JSON.stringify(payload)]
    );

    this.logger.log(`Published event ${eventType} (${event.uuid}) on ${aggregateType}:${aggregateId}`);
    return event.uuid;
  }

  /**
   * Dispatch an event to all registered handlers idempotently
   */
  async dispatchEventIdempotently(eventId: number, handlerName: string, execute: () => Promise<void>): Promise<boolean> {
    // Check if handler already processed this event
    const alreadyProcessed = await this.db.queryOne(
      `SELECT id FROM event_processing WHERE event_id = $1 AND handler_name = $2`,
      [eventId, handlerName]
    );

    if (alreadyProcessed) {
      return false; // Skip execution
    }

    // Execute handler
    await execute();

    // Record processing
    await this.db.query(
      `INSERT INTO event_processing (event_id, handler_name, processed_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (event_id, handler_name) DO NOTHING`,
      [eventId, handlerName]
    );

    return true;
  }
}
