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
    const configuredApiKey =
      this.configService.get<string>('adminApiKey') || process.env.ADMIN_API_KEY;

    if (!configuredApiKey) {
      throw new UnauthorizedException('Admin API key is not configured on this server.');
    }

    // Check header x-api-key, Authorization: ApiKey <key>, or query apiKey
    const headerKey = request.headers['x-api-key'];
    const authHeader = request.headers['authorization'];
    let providedApiKey = typeof headerKey === 'string' ? headerKey : undefined;

    if (!providedApiKey && typeof authHeader === 'string') {
      if (authHeader.startsWith('ApiKey ')) {
        providedApiKey = authHeader.substring(7).trim();
      } else if (authHeader.startsWith('Bearer ')) {
        // In case an admin client passes the key in Bearer format
        providedApiKey = authHeader.substring(7).trim();
      }
    }

    if (!providedApiKey && typeof request.query?.apiKey === 'string') {
      providedApiKey = request.query.apiKey;
    }

    if (!providedApiKey) {
      throw new UnauthorizedException('Missing required x-api-key header.');
    }

    // Constant-time comparison to prevent timing attacks
    const configuredBuffer = Buffer.from(configuredApiKey, 'utf-8');
    const providedBuffer = Buffer.from(providedApiKey, 'utf-8');

    if (
      configuredBuffer.length !== providedBuffer.length ||
      !timingSafeEqual(configuredBuffer, providedBuffer)
    ) {
      throw new UnauthorizedException('Invalid Admin API Key.');
    }

    // Attach admin metadata to request for logging/auditing
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
