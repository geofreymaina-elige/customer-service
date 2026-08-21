import { Controller, Get } from '@nestjs/common';
import { DatabaseService } from '../../core/database/database.service';

@Controller('health')
export class HealthController {
  constructor(private readonly db: DatabaseService) {}

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
      port: 5000,
      timestamp: new Date().toISOString(),
      dependencies: {
        database: dbStatus,
      },
    };
  }
}
