import { Controller, Get, Post, Body, Param, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { WalletService } from '../services/wallet.service';
import { LockWalletDto, UnlockWalletDto } from '../dto/wallet.dto';
import { AuthGuard } from '../../../core/auth/auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../../core/auth/current-user.decorator';
import { MessageService } from '../../../core/messages/message.service';

@Controller('api/v1/wallets')
export class WalletController {
  constructor(
    private readonly walletService: WalletService,
    private readonly messages: MessageService,
  ) {}

  @Get('me')
  @UseGuards(AuthGuard)
  async getMyWallet(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.walletService.getWalletByCustomerId(user.id);
    return {
      success: true,
      data,
    };
  }

  @Get('me/onboarding-status')
  @UseGuards(AuthGuard)
  async getMyWalletOnboardingStatus(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.walletService.getWalletOnboardingStatus(user.id);
    return {
      success: true,
      data,
    };
  }

  @Get('me/status')
  @UseGuards(AuthGuard)
  async getMyWalletStatus(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.walletService.getWalletByCustomerId(user.id);
    return {
      success: true,
      data: {
        walletId: data.walletId,
        accountNumber: data.accountNumber,
        status: data.status,
        isLocked: data.isLocked,
        lockReason: data.lockReason,
        lockedAt: data.lockedAt,
        freezeType: data.freezeType,
        tierLevel: data.tierLevel,
      },
    };
  }

  @Post('lock')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  async lockWallet(@CurrentUser() user: AuthenticatedUser, @Body() dto: LockWalletDto) {
    const data = await this.walletService.lockWallet(user.id, dto, `CUSTOMER:${user.id}`);
    return {
      success: true,
      message: this.messages.get('wallets.lockedSuccess'),
      data,
    };
  }

  @Post('unlock')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  async unlockWallet(@CurrentUser() user: AuthenticatedUser, @Body() dto: UnlockWalletDto) {
    const data = await this.walletService.unlockWallet(user.id, dto, `CUSTOMER:${user.id}`);
    return {
      success: true,
      message: this.messages.get('wallets.unlockedSuccess'),
      data,
    };
  }

  @Get(':uuid')
  @UseGuards(AuthGuard)
  async getWalletByUuid(@Param('uuid') uuid: string) {
    const data = await this.walletService.getWalletByUuid(uuid);
    return {
      success: true,
      data,
    };
  }
}
