import { Controller, Get, Delete, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { DeviceGatekeeperService } from '../services/device-gatekeeper.service';
import { RevokeDeviceDto } from '../dto/device.dto';
import { MessageService } from '../../../core/messages/message.service';
import { AuthGuard } from '../../../core/auth/auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../../core/auth/current-user.decorator';

@Controller('')
export class DeviceController {
  constructor(
    private readonly deviceGatekeeper: DeviceGatekeeperService,
    private readonly messages: MessageService,
  ) {}

  @Get('api/v2/customers/me/sessions')
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

  @Delete('api/v2/customers/me/sessions')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  async revokeDevice(@CurrentUser() user: AuthenticatedUser, @Body() dto: RevokeDeviceDto) {
    return this.deviceGatekeeper.revokeDevice(user.id, dto.sessionId);
  }
}
