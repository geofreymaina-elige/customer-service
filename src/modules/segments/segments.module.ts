import { Module } from '@nestjs/common';
import { AdminApiKeyGuard } from '../../core/auth/admin-api-key.guard';
import { SegmentMembershipController } from './segment-membership.controller';
import { SegmentMembershipService } from './segment-membership.service';

@Module({
  controllers: [SegmentMembershipController],
  providers: [AdminApiKeyGuard, SegmentMembershipService],
})
export class SegmentsModule {}
