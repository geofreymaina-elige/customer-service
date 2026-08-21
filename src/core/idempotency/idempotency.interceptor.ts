import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  ConflictException,
} from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { DatabaseService } from '../database/database.service';
import * as crypto from 'crypto';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly db: DatabaseService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const idempotencyKey = request.headers['idempotency-key'] || request.headers['x-idempotency-key'];

    if (!idempotencyKey || request.method === 'GET') {
      return next.handle();
    }

    const path = request.path;
    const bodyHash = crypto.createHash('sha256').update(JSON.stringify(request.body || {})).digest('hex');

    // Check if key already exists
    const existing = await this.db.queryOne(
      `SELECT response_code, response_body, expires_at FROM idempotency_keys WHERE key = $1`,
      [idempotencyKey]
    );

    if (existing) {
      if (new Date(existing.expires_at) < new Date()) {
        await this.db.query(`DELETE FROM idempotency_keys WHERE key = $1`, [idempotencyKey]);
      } else if (existing.response_code) {
        response.status(existing.response_code);
        return of(existing.response_body);
      } else {
        throw new ConflictException('A request with this Idempotency-Key is currently processing.');
      }
    }

    // Insert pending idempotency record (valid for 24 hours)
    await this.db.query(
      `INSERT INTO idempotency_keys (key, request_path, request_hash, expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '24 hours')
       ON CONFLICT (key) DO NOTHING`,
      [idempotencyKey, path, bodyHash]
    );

    return next.handle().pipe(
      tap(async (responseBody) => {
        const statusCode = response.statusCode || 200;
        await this.db.query(
          `UPDATE idempotency_keys SET response_code = $1, response_body = $2 WHERE key = $3`,
          [statusCode, JSON.stringify(responseBody), idempotencyKey]
        );
      })
    );
  }
}
