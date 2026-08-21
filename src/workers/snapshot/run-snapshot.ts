import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { SnapshotWorker } from './snapshot.worker';

/**
 * Snapshot Worker Runner
 * 
 * Usage:
 *   ts-node src/workers/snapshot/run-snapshot.ts
 * 
 * This script runs the snapshot worker to load historical customer data
 * from ASTPP MySQL into PostgreSQL.
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  
  const snapshotWorker = app.get(SnapshotWorker);
  
  try {
    await snapshotWorker.run();
    console.log('\n✓ Snapshot worker completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('\n✗ Snapshot worker failed:', error);
    process.exit(1);
  } finally {
    await app.close();
  }
}

bootstrap();
