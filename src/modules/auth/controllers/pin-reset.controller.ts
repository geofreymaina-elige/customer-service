import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { PinResetService } from '../services/pin-reset.service';
import {
  InitiatePinResetDto,
  VerifyResetOtpDto,
  CompletePinResetDto,
} from '../dto/pin-reset.dto';
import { MessageService } from '../../../core/messages/message.service';

@Controller('api/v1/auth/reset-pin')
export class PinResetController {
  constructor(
    private readonly pinResetService: PinResetService,
    private readonly messages: MessageService,
  ) {}

  @Post('initiate')
  @HttpCode(HttpStatus.OK)
  async initiateReset(@Body() dto: InitiatePinResetDto) {
    const data = await this.pinResetService.initiateReset(dto);
    return {
      success: true,
      message: this.messages.get('auth.reset.initiated'),
      data,
    };
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  async verifyOtp(@Body() dto: VerifyResetOtpDto) {
    const data = await this.pinResetService.verifyOtp(dto);
    return {
      success: true,
      message: this.messages.get('auth.reset.otpVerified'),
      data,
    };
  }

  @Post('complete')
  @HttpCode(HttpStatus.OK)
  async completeReset(@Body() dto: CompletePinResetDto) {
    return this.pinResetService.completeReset(dto);
  }
}
