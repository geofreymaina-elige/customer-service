import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { WalletService } from '../services/wallet.service';
import { AuthGuard } from '../../../core/auth/auth.guard';
import { JwtScopes } from '../../../core/auth/jwt.service';
import { RequireScopes } from '../../../core/auth/scopes.decorator';
import { AstppTokenGuard } from '../../../core/auth/astpp-token.guard';
import { CurrentUser, AuthenticatedUser } from '../../../core/auth/current-user.decorator';

@Controller('api/v2/wallets')
export class WalletController {
  constructor(
    private readonly walletService: WalletService,
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

  @Get('onboarding-status')
  @UseGuards(AstppTokenGuard)
  async getWalletOnboardingStatus(@Query('astppId') astppId: string) {
    const data = await this.walletService.getWalletOnboardingStatusByAstppId(astppId);
    return {
      success: true,
      data,
    };
  }

  @Get('me/balance')
  @UseGuards(AuthGuard)
  @RequireScopes(JwtScopes.Transaction)
  async getMyBalance(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.walletService.getBalance(user.id);
    return {
      success: true,
      data,
    };
  }
}
