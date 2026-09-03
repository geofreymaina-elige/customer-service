import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { validateAndDecryptToken } from './astpp-token.util';

/**
 * AstppTokenGuard — validates the ASTPP token passed in the X-Astpp-Token header.
 *
 * It resolves the ASTPP account ID from:
 *   1. req.params.astppId   (GET routes like /wallets/:astppId/onboarding-status)
 *   2. req.body.astpp_id    (POST routes like /onboarding/user-device)
 *
 * The token is expected in the HTTP header: X-Astpp-Token
 *
 * Throws BadRequestException({ status: false, error: 'Invalid key' }) on failure.
 */
@Injectable()
export class AstppTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    // Resolve astpp id — prefer URL param, fall back to body
    const astppId: string | undefined =
      (request.params?.astppId as string | undefined) ||
      (request.body?.astpp_id as string | undefined);

    const token = request.headers['x-astpp-token'] as string | undefined;

    // validateAndDecryptToken throws BadRequestException on mismatch
    validateAndDecryptToken(astppId ?? '', token);

    return true;
  }
}
