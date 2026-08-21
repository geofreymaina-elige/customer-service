import { Module } from '@nestjs/common';
import { PinAuthService } from './services/pin-auth.service';
import { PinResetService } from './services/pin-reset.service';
import { PinAuthController } from './controllers/pin-auth.controller';
import { PinResetController } from './controllers/pin-reset.controller';
import { SecureJwtService } from '../../core/auth/jwt.service';

@Module({
  controllers: [PinAuthController, PinResetController],
  providers: [PinAuthService, PinResetService, SecureJwtService],
  exports: [PinAuthService, PinResetService, SecureJwtService],
})
export class AuthModule {}
