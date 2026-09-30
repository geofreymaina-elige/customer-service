import { Controller, Get, UseGuards } from '@nestjs/common';
import { AppConfigService } from '../services/app-config.service';
import { AuthGuard } from '../../../core/auth/auth.guard';
import { RequireScopes } from '../../../core/auth/scopes.decorator';
import { JwtScopes } from '../../../core/auth/jwt.service';

@Controller('api/v1')
export class AppConfigController {
  constructor(private readonly appConfigService: AppConfigService) {}

  @Get('app-config')
  @UseGuards(AuthGuard)
  @RequireScopes(JwtScopes.AppAccess)
  async getAppConfig() {
    const data = await this.appConfigService.getAppConfig();
    return data;
  }
}
