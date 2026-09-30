import { Module } from '@nestjs/common';
import { AppConfigController } from './controllers/app-config.controller';
import { AppConfigService } from './services/app-config.service';
import { DatabaseModule } from '../../core/database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [AppConfigController],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
