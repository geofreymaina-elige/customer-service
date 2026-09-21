import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SecureJwtService } from './jwt.service';
import { DatabaseService } from '../database/database.service';
import { REQUIRED_SCOPES_KEY } from './scopes.decorator';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: SecureJwtService,
    private readonly db: DatabaseService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid Authorization header.');
    }

    const token = authHeader.substring(7);
    const deviceHeader = request.headers['x-device-hash'] || request.headers['x-device-identifier'];

    const payload = this.jwtService.verifyToken(token, deviceHeader ? String(deviceHeader) : undefined);

    // Verify customer exists and is not deleted, suspended, or closed
    const customer = await this.db.queryOne(
      `SELECT id, uuid, voip_number, status, deleted_at FROM customers WHERE id = $1`,
      [payload.customerId]
    );

    if (!customer || customer.deleted_at || customer.status === 'suspended' || customer.status === 'closed') {
      throw new UnauthorizedException('Customer account is inactive or not found.');
    }

    const requiredScopes = this.reflector.getAllAndOverride<string[]>(REQUIRED_SCOPES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) || [];

    if (requiredScopes.length > 0) {
      const tokenScopes = payload.scope || [];
      const hasAllScopes = requiredScopes.every((scope) => tokenScopes.includes(scope));

      if (!hasAllScopes) {
        throw new ForbiddenException('Authentication token does not have the required scope.');
      }
    }

    // Verify customer device is still active
    if (payload.deviceHash) {
      const activeDevice = await this.db.queryOne(
        `SELECT id FROM customer_devices WHERE customer_id = $1 AND device_uuid_hash = $2 AND status = 'active'`,
        [payload.customerId, payload.deviceHash]
      );

      if (!activeDevice) {
        throw new UnauthorizedException('Device session has expired or was revoked.');
      }
    }

    request.user = {
      id: customer.id,
      uuid: customer.uuid,
      voipNumber: customer.voip_number,
      deviceHash: payload.deviceHash,
      scope: payload.scope,
    };

    return true;
  }
}
