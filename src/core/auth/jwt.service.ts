import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';

export interface TokenPayload {
  sub: string;           // Customer UUID
  customerId: number;    // Internal Customer ID
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

@Injectable()
export class SecureJwtService {
  private readonly secret: string;
  private readonly expiresInSeconds: number;

  constructor(private configService: ConfigService) {
    this.secret = this.configService.get<string>('jwt.secret') || 'default_secret';
    this.expiresInSeconds = this.configService.get<number>('jwt.expiresInSeconds') || 900;

    if (!this.secret || this.secret.length < 32) {
      console.warn('[SECURITY WARNING] JWT_SECRET should be at least 32 characters long for production security.');
    }
  }

  generateToken(
    customer: { id: number; uuid: string; voip_number: string },
    deviceHash: string,
    scopes: string[] = ['customer:read', 'customer:write', 'device:manage', 'wallet:control']
  ): TokenResponse {
    const jti = crypto.randomUUID();
    const payload: TokenPayload = {
      sub: customer.uuid,
      customerId: customer.id,
      deviceHash,
      voipNumber: customer.voip_number,
      jti,
      scope: scopes,
      iss: 'customer-management-service',
      aud: 'ambia-client',
    };

    const accessToken = jwt.sign(payload, this.secret, {
      algorithm: 'HS256',
      expiresIn: this.expiresInSeconds,
    });

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresInSeconds: this.expiresInSeconds,
    };
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
    const salt = this.configService.get<string>('security.deviceUuidSalt') || 'AMBIA_DEVICE_SALT_SECURE_2026_X99';
    const raw = `${deviceIdentifier}|${deviceModel}|${mobileType}|${salt}`;
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  hashOtp(otpCode: string): string {
    const salt = this.configService.get<string>('security.otpSalt') || 'AMBIA_OTP_SALT_SECURE_2026_V1';
    return crypto.createHash('sha256').update(`${otpCode}|${salt}`).digest('hex');
  }
}
