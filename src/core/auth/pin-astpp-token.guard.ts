import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import { Request } from 'express';
import { DatabaseService } from '../database/database.service';
import { MessageService } from '../messages/message.service';
import { validateAndDecryptToken } from './astpp-token.util';

@Injectable()
export class PinAstppTokenGuard implements CanActivate {
  constructor(
    private readonly db: DatabaseService,
    private readonly messages: MessageService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const body = request.body ?? {};
    const tokenHeader = request.headers['x-astpp-token'];
    const token = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;

    const astppId = await this.resolveAstppId(body);
    validateAndDecryptToken(astppId, token);

    return true;
  }

  private async resolveAstppId(body: Record<string, unknown>): Promise<string> {
    const directId = body.astpp_id ?? body.astppId;
    if (typeof directId === 'string' && directId.trim()) {
      return directId.trim();
    }

    if (typeof body.customerId === 'string' && body.customerId.trim()) {
      const customer = await this.db.queryOne<{ astpp_id: string | number | null }>(
        `SELECT astpp_id
         FROM customers
         WHERE astpp_id::text = $1 OR uuid::text = $1 OR id::text = $1
         LIMIT 1`,
        [body.customerId.trim()],
      );

      if (customer?.astpp_id !== null && customer?.astpp_id !== undefined) {
        return String(customer.astpp_id);
      }
    }

    if (typeof body.sessionToken === 'string' && body.sessionToken.trim()) {
      const sessionTokenHash = crypto
        .createHash('sha256')
        .update(body.sessionToken.trim())
        .digest('hex');
      const customer = await this.db.queryOne<{ astpp_id: string | number | null }>(
        `SELECT c.astpp_id
         FROM customer_pin_reset_sessions s
         JOIN customers c ON c.id = s.customer_id
         WHERE s.session_token_hash = $1
           AND s.invalidated_at IS NULL
         LIMIT 1`,
        [sessionTokenHash],
      );

      if (customer?.astpp_id !== null && customer?.astpp_id !== undefined) {
        return String(customer.astpp_id);
      }
    }

    throw new BadRequestException({
      message: this.messages.get('auth.invalidCredentials'),
      errors: ['Invalid or missing ASTPP ID or session token']
    });
  }
}