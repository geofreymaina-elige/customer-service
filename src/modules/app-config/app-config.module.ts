import { Module } from '@nestjs/common';
import { AppConfigController } from './controllers/app-config.controller';
import { AppConfigService } from './services/app-config.service';
import { DatabaseModule } from '../../core/database/database.module';
import { SecureJwtService } from '../../core/auth/jwt.service';
import { OptionalAstppBannerGuard } from '../../core/auth/optional-astpp-banner.guard';

@Module({
  imports: [DatabaseModule],
  controllers: [AppConfigController],
  providers: [AppConfigService, SecureJwtService, OptionalAstppBannerGuard],
  exports: [AppConfigService],
})
export class AppConfigModule {}
