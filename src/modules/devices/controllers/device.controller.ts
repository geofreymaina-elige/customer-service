import { Controller, Get, Delete, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import {
  ApiExcludeEndpoint,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { DeviceGatekeeperService } from '../services/device-gatekeeper.service';
import { RevokeDeviceDto } from '../dto/device.dto';
import { MessageService } from '../../../core/messages/message.service';
import { AuthGuard } from '../../../core/auth/auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../../core/auth/current-user.decorator';

@ApiTags('Device and Logout Management')
@Controller('')
export class DeviceController {
  constructor(
    private readonly deviceGatekeeper: DeviceGatekeeperService,
    private readonly messages: MessageService,
  ) {}

  @Get('api/v2/customers/me/sessions')
  @UseGuards(AuthGuard)
  @ApiSecurity('API-Key')
  @ApiSecurity('AppAccessToken')
  @ApiOperation({
    summary: 'List the customer’s device sessions',
    description: 'Returns the customer’s registered device sessions, including active and revoked devices. A customer can have only one active device at a time. To use a new device, sign out from the current device first, or complete the device recovery flow.',
  })
  @ApiResponse({
    status: 200,
    description: 'Device sessions retrieved successfully.',
    schema: {
      example: {
        success: true,
        data: {
          devices: [
            {
              uuid: 'b286d010-8e02-4e3a-aa23-993354f1a2ca',
              device_identifier: 'SAM-S23-DEVICE-UUID-10492',
              device_model: 'Samsung Galaxy S23',
              device_os: 'Android 14',
              mobile_type: 'android',
              app_version: '2.4.1',
              status: 'active',
              last_active_at: '2026-11-12T12:00:00.000Z',
              created_at: '2026-11-01T10:00:00.000Z',
              revoked_at: null,
            },
          ],
          total: 1,
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid App Access Token, or the device session has been revoked.' })
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
  @ApiExcludeEndpoint()
  async revokeDevice(@CurrentUser() user: AuthenticatedUser, @Body() dto: RevokeDeviceDto) {
    return this.deviceGatekeeper.revokeDevice(user.id, dto.sessionId);
  }
}
