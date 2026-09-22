import { Controller, Post, Put, Body, Req, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { PinAuthService } from '../services/pin-auth.service';
import { SetPinDto, VerifyPinDto, ChangePinDto } from '../dto/pin-auth.dto';
import { MessageService } from '../../../core/messages/message.service';
import { AuthGuard } from '../../../core/auth/auth.guard';
import { PinAstppTokenGuard } from '../../../core/auth/pin-astpp-token.guard';
import { CurrentUser, AuthenticatedUser } from '../../../core/auth/current-user.decorator';

@Controller('')
export class PinAuthController {
  constructor(
    private readonly pinAuthService: PinAuthService,
    private readonly messages: MessageService,
  ) {}

  @Post('api/v2/customers/me/pin')
  @UseGuards(PinAstppTokenGuard)
  @HttpCode(HttpStatus.OK)
  async setPin(@Body() dto: SetPinDto) {
    return this.pinAuthService.setPin(dto);
  }

  @Put('api/v2/customers/me/pin')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  async changePin(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChangePinDto) {
    return this.pinAuthService.changePin(user.id, dto);
  }

  @Post('api/v2/auth/transaction-tokens')
  @UseGuards(PinAstppTokenGuard)
  @HttpCode(HttpStatus.OK)
  async exchangePinForTransactionToken(@Body() dto: VerifyPinDto, @Req() req: Request) {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',').shift()?.trim() || req.ip || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || '';

    const result = await this.pinAuthService.verifyPin(dto, ip, userAgent);

    return {
      success: true,
      message: this.messages.get('auth.pin.verifySuccess'),
      data: result,
    };
  }
}
