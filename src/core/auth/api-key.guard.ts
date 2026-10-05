import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'crypto';

/**
 * Guard to validate API key for all API requests.
 * API key should be provided in X-API-Key header.
 * 
 * Usage:
 * - Apply globally in main.ts for all routes
 * - Or apply to specific controllers/routes with @UseGuards(ApiKeyGuard)
 * - Use @Public() decorator to skip API key validation for specific endpoints
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    // Check if route is marked as public
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const configuredApiKey =
      this.configService.get<string>('apiKey') || process.env.API_KEY;

    if (!configuredApiKey) {
      // If API key is not configured, allow request (backward compatibility)
      return true;
    }

    // Check X-API-Key header, Authorization: ApiKey <key>, or query parameter
    const headerKey = request.headers['x-api-key'];
    const authHeader = request.headers['authorization'];
    const queryKey = request.query?.apiKey || request.query?.api_key;
    let providedApiKey = typeof headerKey === 'string' ? headerKey : undefined;

    if (!providedApiKey && typeof authHeader === 'string') {
      if (authHeader.startsWith('ApiKey ')) {
        providedApiKey = authHeader.substring(7).trim();
      }
    }

    // Allow API key in query parameter (useful for docs endpoint)
    if (!providedApiKey && typeof queryKey === 'string') {
      providedApiKey = queryKey;
    }

    if (!providedApiKey) {
      throw new UnauthorizedException({
        success: false,
        message: 'Missing required X-API-Key header or apiKey query parameter.',
        code: 'MISSING_API_KEY',
      });
    }

    // Constant-time comparison to prevent timing attacks
    const configuredBuffer = Buffer.from(configuredApiKey, 'utf-8');
    const providedBuffer = Buffer.from(providedApiKey, 'utf-8');

    if (
      configuredBuffer.length !== providedBuffer.length ||
      !timingSafeEqual(configuredBuffer, providedBuffer)
    ) {
      throw new UnauthorizedException({
        success: false,
        message: 'Invalid API Key.',
        code: 'INVALID_API_KEY',
      });
    }

    return true;
  }
}
