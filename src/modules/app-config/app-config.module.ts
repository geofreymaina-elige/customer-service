import { Module } from '@nestjs/common';
import { AppConfigController } from './controllers/app-config.controller';
import { AppConfigService } from './services/app-config.service';
import { DatabaseModule } from '../../core/database/database.module';
import { SecureJwtService } from '../../core/auth/jwt.service';
import { AstppTokenGuard } from '../../core/auth/astpp-token.guard';

@Module({
  imports: [DatabaseModule],
  controllers: [AppConfigController],
  providers: [AppConfigService, SecureJwtService, AstppTokenGuard],
  exports: [AppConfigService],
})
export class AppConfigModule {}
