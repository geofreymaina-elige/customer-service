import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';

export interface TokenPayload {
  sub: string;           // Customer UUID
  astppId?: number;      // ASTPP account ID used by external services
  customerId?: number;   // Internal ID on tokens issued before astppId was added
  deviceHash: string;    // Bound Device Fingerprint Hash
  voipNumber: string;    // Customer VoIP number
  jti: string;           // Unique JWT ID
  scope: string[];
  iss: string;
  aud: string;
  iat?: number;
  exp?: number;
}

export interface TokenResponse {
  accessToken: string;
  tokenType: string;
  expiresInSeconds: number;
}

export const JwtScopes = {
  AppAccess: 'app:access',
  Transaction: 'wallet:transact',
} as const;

@Injectable()
export class SecureJwtService {
  private readonly secret: string;
  private readonly transactionExpiresInSeconds: number;
  private readonly appAccessExpiresInSeconds: number;

  constructor(private configService: ConfigService) {
    this.secret = this.configService.getOrThrow<string>('jwt.secret');
    this.transactionExpiresInSeconds = this.configService.getOrThrow<number>('jwt.expiresInSeconds');
    this.appAccessExpiresInSeconds = this.configService.getOrThrow<number>('jwt.appAccessExpiresInSeconds');
  }

  generateToken(
    customer: { uuid: string; astpp_id: number; voip_number: string },
    deviceHash: string,
    scopes: string[] = [JwtScopes.AppAccess],
    expiresInSeconds: number = this.transactionExpiresInSeconds,
  ): TokenResponse {
    if (!Number.isInteger(customer.astpp_id)) {
      throw new UnauthorizedException('Customer ASTPP ID is required to issue an authentication token.');
    }

    const jti = crypto.randomUUID();
    const payload: TokenPayload = {
      sub: customer.uuid,
      astppId: customer.astpp_id,
      deviceHash,
      voipNumber: customer.voip_number,
      jti,
      scope: scopes,
      iss: 'customer-management-service',
      aud: 'ambia-client',
    };

    const accessToken = jwt.sign(payload, this.secret, {
      algorithm: 'HS256',
      expiresIn: expiresInSeconds,
    });

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresInSeconds,
    };
  }

  generateAppAccessToken(
    customer: { id: number; uuid: string; astpp_id: number; voip_number: string },
    deviceHash: string,
  ): TokenResponse {
    return this.generateToken(customer, deviceHash, [JwtScopes.AppAccess], this.appAccessExpiresInSeconds);
  }

  generateTransactionToken(
    customer: { id: number; uuid: string; astpp_id: number; voip_number: string },
    deviceHash: string,
  ): TokenResponse {
    return this.generateToken(customer, deviceHash, [JwtScopes.Transaction], this.transactionExpiresInSeconds);
  }

  verifyToken(token: string, currentDeviceHash?: string): TokenPayload {
    try {
      const payload = jwt.verify(token, this.secret, {
        algorithms: ['HS256'],
        issuer: ['customer-management-service', 'ambia-pay'],
        audience: 'ambia-client',
      }) as TokenPayload;

      // If device verification is requested, enforce that the token is bound to this device
      if (currentDeviceHash && payload.deviceHash && payload.deviceHash !== currentDeviceHash) {
        throw new UnauthorizedException('Authentication token is bound to a different device.');
      }

      return payload;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid or expired authentication token.');
    }
  }

  hashDevice(deviceIdentifier: string, deviceModel: string, mobileType: string): string {
    const salt = this.configService.getOrThrow<string>('security.deviceUuidSalt');
    const raw = `${deviceIdentifier}|${deviceModel}|${mobileType}|${salt}`;
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  hashOtp(otpCode: string): string {
    const salt = this.configService.getOrThrow<string>('security.otpSalt');
    return crypto.createHash('sha256').update(`${otpCode}|${salt}`).digest('hex');
  }
}
