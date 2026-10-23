import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { DatabaseService } from '../database/database.service';
import { validateAndDecryptToken } from './astpp-token.util';

export interface BannerAudience {
  astppId: string;
  fcmToken?: string;
}

type BannerRequest = Request & {
  bannerAudience?: BannerAudience;
};

@Injectable()
export class OptionalAstppBannerGuard implements CanActivate {
  private readonly logger = new Logger(OptionalAstppBannerGuard.name);

  constructor(private readonly db: DatabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<BannerRequest>();
    const astppIdHeader = request.headers['x-astpp-id'];
    const tokenHeader = request.headers['x-astpp-token'];
    const astppId = typeof astppIdHeader === 'string' ? astppIdHeader.trim() : '';
    const token = typeof tokenHeader === 'string' ? tokenHeader.trim() : '';

    request.bannerAudience = undefined;
    if (!astppId || !token) {
      return true;
    }

    let validatedAstppId: string;
    try {
      validatedAstppId = validateAndDecryptToken(astppId, token);
    } catch {
      this.logger.warn('Banner ASTPP authentication failed; using general banners.');
      return true;
    }

    const customer = await this.db.queryOne<{ id: number }>(
      'SELECT id FROM customers WHERE astpp_id = $1 LIMIT 1',
      [validatedAstppId]
    );
    if (!customer) {
      this.logger.warn('Banner ASTPP account has no customer record; using general banners.');
      return true;
    }

    const fcmTokenHeader = request.headers['x-fcm-token'];
    const fcmToken = typeof fcmTokenHeader === 'string' ? fcmTokenHeader.trim() : '';
    request.bannerAudience = {
      astppId: validatedAstppId,
      ...(fcmToken ? { fcmToken } : {}),
    };
    return true;
  }
}
