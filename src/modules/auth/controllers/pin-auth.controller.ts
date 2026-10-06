import { Controller, Post, Put, Body, Req, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity, ApiBody } from '@nestjs/swagger';
import { Request } from 'express';
import { PinAuthService } from '../services/pin-auth.service';
import { SetPinDto, VerifyPinDto, ChangePinDto } from '../dto/pin-auth.dto';
import { MessageService } from '../../../core/messages/message.service';
import { AuthGuard } from '../../../core/auth/auth.guard';
import { PinAstppTokenGuard } from '../../../core/auth/pin-astpp-token.guard';
import { CurrentUser, AuthenticatedUser } from '../../../core/auth/current-user.decorator';

@ApiTags('PIN Management')
@ApiSecurity('API-Key')
@Controller('')
export class PinAuthController {
  constructor(
    private readonly pinAuthService: PinAuthService,
    private readonly messages: MessageService,
  ) {}

  @Post('api/v2/customers/me/pin')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Set PIN (First Time)',
    description: 'Set a 4-digit PIN for the customer after OTP verification. This is typically done once during onboarding after the user has verified their phone number.',
  })
  @ApiSecurity('AppAccessToken')
  @ApiBody({
    description: 'PIN setup request',
    schema: {
      type: 'object',
      required: ['pin', 'confirm_pin'],
      properties: {
        pin: {
          type: 'string',
          pattern: '^\\d{4}$',
          example: '1234',
          description: '4-digit PIN'
        },
        confirm_pin: {
          type: 'string',
          pattern: '^\\d{4}$',
          example: '1234',
          description: 'Confirm 4-digit PIN (must match pin)'
        }
      }
    }
  })
  @ApiResponse({
    status: 200,
    description: 'PIN successfully set',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'PIN set successfully' },
        data: {
          type: 'object',
          properties: {
            pin_set: { type: 'boolean', example: true }
          }
        }
      }
    }
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed - PINs do not match or invalid format',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        message: { type: 'string', example: 'PIN and confirm PIN do not match' }
      }
    }
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing AppAccessToken',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        message: { type: 'string', example: 'Unauthorized' }
      }
    }
  })
  async setPin(@CurrentUser() user: AuthenticatedUser, @Body() dto: SetPinDto) {
    return this.pinAuthService.setPin(dto, user.id);
  }

  @Put('api/v2/customers/me/pin')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Change PIN',
    description: 'Change the existing 4-digit PIN. Requires the current PIN to be provided for verification.',
  })
  @ApiSecurity('AppAccessToken')
  @ApiBody({
    description: 'PIN change request',
    schema: {
      type: 'object',
      required: ['current_pin', 'new_pin', 'confirm_new_pin'],
      properties: {
        current_pin: {
          type: 'string',
          pattern: '^\\d{4}$',
          example: '1234',
          description: 'Current 4-digit PIN'
        },
        new_pin: {
          type: 'string',
          pattern: '^\\d{4}$',
          example: '5678',
          description: 'New 4-digit PIN'
        },
        confirm_new_pin: {
          type: 'string',
          pattern: '^\\d{4}$',
          example: '5678',
          description: 'Confirm new 4-digit PIN (must match new_pin)'
        }
      }
    }
  })
  @ApiResponse({
    status: 200,
    description: 'PIN successfully changed',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'PIN changed successfully' }
      }
    }
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed - Current PIN incorrect or new PINs do not match',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        message: { type: 'string', example: 'Current PIN is incorrect' }
      }
    }
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing AppAccessToken',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        message: { type: 'string', example: 'Unauthorized' }
      }
    }
  })
  async changePin(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChangePinDto) {
    return this.pinAuthService.changePin(user.id, dto);
  }


}
