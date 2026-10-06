import { Controller, Get } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { DatabaseService } from '../../core/database/database.service';
import { Public } from '../../core/auth/public.decorator';

@ApiExcludeController()
@Controller('health')
export class HealthController {
  constructor(private readonly db: DatabaseService) {}

  @Public()
  @Get()
  async check() {
    let dbStatus = 'healthy';
    try {
      await this.db.query('SELECT 1');
    } catch (error) {
      dbStatus = 'unhealthy';
    }

    return {
      status: 'ok',
      service: 'ambia-pay',
      port: process.env.PORT || '5006',
      timestamp: new Date().toISOString(),
      dependencies: {
        database: dbStatus,
      },
    };
  }
}
