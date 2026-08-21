import { Controller, Post, Body, Req, HttpCode, HttpStatus, Get, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { DeviceGatekeeperService } from '../services/device-gatekeeper.service';
import { DeviceLogoutService } from '../services/device-logout.service';
import { InitiateDeviceLogoutDto, VerifyDeviceLogoutDto, RevokeDeviceDto } from '../dto/device.dto';
import { MessageService } from '../../../core/messages/message.service';
import { AuthGuard } from '../../../core/auth/auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../../core/auth/current-user.decorator';

@Controller('api/v1/auth/device')
export class DeviceController {
  constructor(
    private readonly deviceGatekeeper: DeviceGatekeeperService,
    private readonly deviceLogoutService: DeviceLogoutService,
    private readonly messages: MessageService,
  ) {}

  @Post('logout/initiate')
  @HttpCode(HttpStatus.OK)
  async initiateLogout(@Body() dto: InitiateDeviceLogoutDto) {
    const data = await this.deviceLogoutService.initiateLogout(dto);
    return {
      success: true,
      message: this.messages.get('devices.logoutInitiated'),
      data,
    };
  }

  @Post('logout/verify')
  @HttpCode(HttpStatus.OK)
  async verifyLogout(@Body() dto: VerifyDeviceLogoutDto, @Req() req: Request) {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',').shift()?.trim() || req.ip || '127.0.0.1';
    const result = await this.deviceLogoutService.verifyOtpAndLogout(dto, ip);

    return {
      success: true,
      message: this.messages.get('devices.logoutVerified'),
      data: result,
    };
  }

  @Get('sessions')
  @UseGuards(AuthGuard)
  async getSessions(@CurrentUser() user: AuthenticatedUser) {
    const devices = await this.deviceGatekeeper.getCustomerDevices(user.id);
    return {
      success: true,
      data: {
        devices,
        total: devices.length,
      },
    };
  }

  @Post('revoke')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  async revokeDevice(@CurrentUser() user: AuthenticatedUser, @Body() dto: RevokeDeviceDto) {
    return this.deviceGatekeeper.revokeDevice(user.id, dto.deviceUuid);
  }

  @Post('heartbeat')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  async recordHeartbeat(@CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',').shift()?.trim() || req.ip || '127.0.0.1';
    return this.deviceGatekeeper.recordHeartbeat(user.id, ip);
  }
}
