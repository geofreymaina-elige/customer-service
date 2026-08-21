import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { CdcConsumerWorker } from './cdc-consumer.worker';

/**
 * CDC Consumer Runner
 * 
 * Usage:
 *   ts-node src/workers/cdc/run-cdc-consumer.ts
 * 
 * This script runs the Kafka CDC consumer to sync customer data in real-time
 * from ASTPP MySQL to PostgreSQL.
 * 
 * Press Ctrl+C to stop gracefully.
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  
  const cdcConsumer = app.get(CdcConsumerWorker);
  
  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n\nReceived SIGINT, stopping CDC consumer...');
    await cdcConsumer.stop();
    await app.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n\nReceived SIGTERM, stopping CDC consumer...');
    await cdcConsumer.stop();
    await app.close();
    process.exit(0);
  });

  try {
    console.log('Starting CDC Consumer...');
    await cdcConsumer.start();
    console.log('\n✓ CDC Consumer is running. Press Ctrl+C to stop.');
  } catch (error) {
    console.error('\n✗ CDC Consumer failed to start:', error);
    await app.close();
    process.exit(1);
  }
}

bootstrap();
