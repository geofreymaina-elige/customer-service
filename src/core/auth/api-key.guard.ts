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
 * API key must be provided in X-API-Key header.
 * 
 * IMPORTANT: API_KEY must be set in environment variables.
 * The application will reject all requests if API_KEY is not configured.
 * 
 * Excluded paths (no API key required):
 * - /api/docs (Swagger documentation)
 * - Routes marked with @Public() decorator
 * 
 * Usage:
 * - Applied globally in main.ts for all routes
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
    const request = context.switchToHttp().getRequest();
    
    // Skip API key validation for Swagger docs endpoints
    if (request.path?.startsWith('/api/docs')) {
      return true;
    }

    // Check if route is marked as public
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const configuredApiKey = this.configService.getOrThrow<string>('apiKey');

    // Check X-API-Key header or Authorization: ApiKey <key>
    const headerKey = request.headers['x-api-key'];
    let providedApiKey = typeof headerKey === 'string' ? headerKey : undefined;

    if (!providedApiKey) {
      throw new UnauthorizedException({
        success: false,
        message: 'Missing required X-API-Key header.',
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
