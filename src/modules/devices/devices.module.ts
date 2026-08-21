import { Module } from '@nestjs/common';
import { DeviceGatekeeperService } from './services/device-gatekeeper.service';
import { DeviceLogoutService } from './services/device-logout.service';
import { DeviceController } from './controllers/device.controller';
import { SecureJwtService } from '../../core/auth/jwt.service';

@Module({
  controllers: [DeviceController],
  providers: [DeviceGatekeeperService, DeviceLogoutService, SecureJwtService],
  exports: [DeviceGatekeeperService, DeviceLogoutService],
})
export class DevicesModule {}
