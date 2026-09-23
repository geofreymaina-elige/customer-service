import { Module, Global } from '@nestjs/common';
import { KafkaNotificationService } from './kafka-notification.service';

@Global()
@Module({
  providers: [KafkaNotificationService],
  exports: [KafkaNotificationService],
})
export class NotificationsModule {}
