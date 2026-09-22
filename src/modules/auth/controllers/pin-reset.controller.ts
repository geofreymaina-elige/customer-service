import { Controller, Post, Put, Body, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { PinResetService } from '../services/pin-reset.service';
import {
  InitiatePinResetDto,
  VerifyResetOtpDto,
  CompletePinResetDto,
} from '../dto/pin-reset.dto';
import { MessageService } from '../../../core/messages/message.service';
import { PinAstppTokenGuard } from '../../../core/auth/pin-astpp-token.guard';

@Controller('')
@UseGuards(PinAstppTokenGuard)
export class PinResetController {
  constructor(
    private readonly pinResetService: PinResetService,
    private readonly messages: MessageService,
  ) {}

  @Post('api/v2/pin-resets')
  @HttpCode(HttpStatus.OK)
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
  async completeReset(@Body() dto: CompletePinResetDto) {
    return this.pinResetService.completeReset(dto);
  }
}
