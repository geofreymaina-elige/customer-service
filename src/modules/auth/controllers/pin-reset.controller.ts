import { Controller, Post, Put, Body, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity, ApiBody } from '@nestjs/swagger';
import { PinResetService } from '../services/pin-reset.service';
import {
  InitiatePinResetDto,
  VerifyResetOtpDto,
  CompletePinResetDto,
} from '../dto/pin-reset.dto';
import { MessageService } from '../../../core/messages/message.service';
import { AstppTokenGuard } from '../../../core/auth/astpp-token.guard';

@ApiTags('PIN Management')
@ApiSecurity('API-Key')
@Controller('')
@UseGuards(AstppTokenGuard)
export class PinResetController {
  constructor(
    private readonly pinResetService: PinResetService,
    private readonly messages: MessageService,
  ) {}

  @Post('api/v2/pin-resets')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Initiate PIN Reset',
    description: 'Start the PIN reset process by providing ASTPP ID and ID number. An OTP will be sent to the registered phone number.',
  })
  @ApiSecurity('ASTPP-Token')
  @ApiBody({
    description: 'PIN reset initiation request',
    schema: {
      type: 'object',
      required: ['astpp_id', 'id_number'],
      properties: {
        astpp_id: {
          type: 'string',
          example: '254712345678',
          description: 'Customer ASTPP ID (phone number)'
        },
        id_number: {
          type: 'string',
          example: '12345678',
          description: 'National ID number for verification'
        }
      }
    }
  })
  @ApiResponse({
    status: 200,
    description: 'Identity verified successfully and an OTP was sent to the registered phone number.',
    schema: {
      example: {
        success: true,
        message: 'Identity verified successfully. An OTP has been sent to your registered phone number.',
        data: {
          resetId: '07f1c5cea5c942ebd2c7829ee62f6ccbdf6b2c9e174ca368b168cb9fe2459553',
          maskedPhone: '****0771',
          expiresInMinutes: 5,
        },
      },
    }
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed for the request body.',
    schema: {
      example: {
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Validation failed on the submitted data.',
        errors: ['astpp_id should not be empty'],
      },
    }
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid ASTPP token or identity document number does not match the registered profile.',
    schema: {
      example: {
        success: false,
        code: 'HTTP_ERROR',
        message: 'Identity document number does not match registered profile.',
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'No customer was found for the supplied ASTPP ID.',
    schema: {
      example: {
        success: false,
        code: 'HTTP_ERROR',
        message: 'Resource not found.',
      },
    }
  })
  async initiateReset(@Body() dto: InitiatePinResetDto) {
    const data = await this.pinResetService.initiateReset(dto);
    return {
      success: true,
      message: this.messages.get('auth.reset.initiated'),
      data,
    };
  }

  @Post('api/v2/pin-resets/otp-verifications')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify PIN Reset OTP',
    description: 'Verify the 6-digit OTP sent during PIN reset initiation.',
  })
  @ApiSecurity('ASTPP-Token')
  @ApiBody({
    description: 'OTP verification request',
    schema: {
      type: 'object',
      required: ['astpp_id', 'reset_id', 'otp'],
      properties: {
        astpp_id: {
          type: 'string',
          example: '254712345678',
          description: 'Customer ASTPP ID (phone number)'
        },
        reset_id: {
          type: 'string',
          example: 'rst_a1b2c3d4e5f6',
          description: 'Reset ID from initiation response'
        },
        otp: {
          type: 'string',
          pattern: '^\\d{6}$',
          example: '123456',
          description: '6-digit OTP code'
        }
      }
    }
  })
  @ApiResponse({
    status: 200,
    description: 'OTP verified successfully',
    schema: {
      example: {
        success: true,
        message: 'OTP verified successfully. You can now set your new PIN.',
        data: {
          canResetPin: true,
          resetId: '07f1c5cea5c942ebd2c7829ee62f6ccbdf6b2c9e174ca368b168cb9fe2459553',
        },
      },
    }
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid or expired OTP',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        message: { type: 'string', example: 'Invalid or expired OTP' }
      }
    }
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing ASTPP token',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        message: { type: 'string', example: 'Unauthorized' }
      }
    }
  })
  async verifyOtp(@Body() dto: VerifyResetOtpDto) {
    const data = await this.pinResetService.verifyOtp(dto);
    return {
      success: true,
      message: this.messages.get('auth.reset.otpVerified'),
      data,
    };
  }

  @Put('api/v2/pin-resets/pin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Complete PIN Reset',
    description: 'Set a new PIN after OTP verification during the PIN reset process.',
  })
  @ApiSecurity('ASTPP-Token')
  @ApiBody({
    description: 'New PIN request',
    schema: {
      type: 'object',
      required: ['astpp_id', 'reset_id', 'pin', 'confirm_pin'],
      properties: {
        astpp_id: {
          type: 'string',
          example: '254712345678',
          description: 'Customer ASTPP ID (phone number)'
        },
        reset_id: {
          type: 'string',
          example: 'rst_a1b2c3d4e5f6',
          description: 'Reset ID from initiation response'
        },
        pin: {
          type: 'string',
          pattern: '^\\d{4}$',
          example: '5678',
          description: 'New 4-digit PIN'
        },
        confirm_pin: {
          type: 'string',
          pattern: '^\\d{4}$',
          example: '5678',
          description: 'Confirm new 4-digit PIN (must match pin)'
        }
      }
    }
  })
  @ApiResponse({
    status: 200,
    description: 'PIN reset completed successfully',
    schema: {
      example: {
        success: true,
        message: 'Security PIN reset successfully. Please sign in with your new PIN.',
      },
    }
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed - PINs do not match or reset session invalid',
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
    description: 'Unauthorized - Invalid or missing ASTPP token',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        message: { type: 'string', example: 'Unauthorized' }
      }
    }
  })
  async completeReset(@Body() dto: CompletePinResetDto) {
    return this.pinResetService.completeReset(dto);
  }
}
