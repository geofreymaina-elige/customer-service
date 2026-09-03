import { Controller, Post, Body, Req, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { OnboardingService } from '../services/onboarding.service';
import { SasaPayWaasService } from '../services/sasapay-waas.service';
import {
  OnboardUserDeviceDto,
  PersonalOnboardingDto,
  PersonalOnboardingConfirmDto,
  SasaPayOnboardingCallbackDto,
} from '../dto/onboarding.dto';
import { MessageService } from '../../../core/messages/message.service';
import { AstppTokenGuard } from '../../../core/auth/astpp-token.guard';

@Controller('api/v1/onboarding')
export class OnboardingController {
  constructor(
    private readonly onboardingService: OnboardingService,
    private readonly sasapayWaas: SasaPayWaasService,
    private readonly messages: MessageService,
  ) {}

  /**
   * Device and Customer Onboarding (matching client expectations)
   */
  @Post('user-device')
  @UseGuards(AstppTokenGuard)
  @HttpCode(HttpStatus.OK)
  async onboardUserDevice(@Body() dto: OnboardUserDeviceDto, @Req() req: Request) {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',').shift()?.trim() || req.ip || '127.0.0.1';
    const result = await this.onboardingService.onboardUserDevice(dto, ip);

    return {
      success: true,
      message: this.messages.get('onboarding.welcome'),
      data: result,
    };
  }

  /**
   * SasaPay WaaS Step 1: Initial Personal Onboarding
   */
  @Post('personal')
  @HttpCode(HttpStatus.ACCEPTED)
  async initiatePersonalOnboarding(@Body() dto: PersonalOnboardingDto) {
    const result = await this.sasapayWaas.initiatePersonalOnboarding(dto);
    return {
      success: result.status,
      message: result.message,
      data: {
        requestId: result.requestId,
      },
    };
  }

  /**
   * SasaPay WaaS Step 2: Personal Onboarding Confirmation with OTP
   */
  @Post('personal/confirm')
  @HttpCode(HttpStatus.OK)
  async confirmPersonalOnboarding(@Body() dto: PersonalOnboardingConfirmDto) {
    const result = await this.sasapayWaas.confirmPersonalOnboarding(dto);
    return {
      success: result.status,
      message: result.message,
      data: result.data,
    };
  }

  /**
   * SasaPay WaaS Webhook Callback
   */
  @Post('callback/sasapay')
  @HttpCode(HttpStatus.OK)
  async handleSasaPayCallback(@Body() dto: SasaPayOnboardingCallbackDto) {
    console.log('[SASAPAY CALLBACK] Received status update:', dto);
    return {
      success: true,
      message: 'Callback received and processed',
    };
  }
}
