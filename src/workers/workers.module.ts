import { Module } from '@nestjs/common';
import { JobsWorker } from './jobs.worker';
import { EventsWorker } from './events.worker';
import { SnapshotWorker } from './snapshot/snapshot.worker';
import { CdcConsumerWorker } from './cdc/cdc-consumer.worker';

@Module({
  providers: [JobsWorker, EventsWorker, SnapshotWorker, CdcConsumerWorker],
  exports: [JobsWorker, EventsWorker, SnapshotWorker, CdcConsumerWorker],
})
export class WorkersModule {}
