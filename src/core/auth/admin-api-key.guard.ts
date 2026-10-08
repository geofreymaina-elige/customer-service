import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';

@Injectable()
export class AdminApiKeyGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const configuredApiKey = this.configService.getOrThrow<string>('adminApiKey');
    const headerKey = request.headers['x-api-key'];
    const providedApiKey = typeof headerKey === 'string' ? headerKey : undefined;

    if (!providedApiKey) {
      throw new UnauthorizedException('Missing required x-api-key header.');
    }

    const configuredBuffer = Buffer.from(configuredApiKey, 'utf-8');
    const providedBuffer = Buffer.from(providedApiKey, 'utf-8');

    if (
      configuredBuffer.length !== providedBuffer.length ||
      !timingSafeEqual(configuredBuffer, providedBuffer)
    ) {
      throw new UnauthorizedException('Invalid Admin API Key.');
    }

    const adminUserId =
      request.headers['x-admin-user-id'] ||
      request.headers['x-admin-email'] ||
      'admin-system';

    request.admin = {
      adminUserId: String(adminUserId),
      authenticatedVia: 'api_key',
    };

    return true;
  }
}
