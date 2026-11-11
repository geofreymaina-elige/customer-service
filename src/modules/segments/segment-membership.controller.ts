import { Controller, Get, Logger, Param, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { AdminApiKeyGuard } from '../../core/auth/admin-api-key.guard';
import { Public } from '../../core/auth/public.decorator';
import { SegmentMembershipService } from './segment-membership.service';

@ApiExcludeController()
@Public()
@UseGuards(AdminApiKeyGuard)
@Controller('api/v1/admin/segments')
export class SegmentMembershipController {
  private readonly logger = new Logger(SegmentMembershipController.name);

  constructor(private readonly segmentMembershipService: SegmentMembershipService) {}

  @Get('customers/:astppId/memberships')
  async getMemberships(@Param('astppId') astppId: string) {
    try {
      const data = await this.segmentMembershipService.getMemberships(astppId);
      return {
        success: true,
        data,
      };
    } catch (error) {
      // Last-resort guard: segment failures must never crash other server operations.
      this.logger.error(JSON.stringify({
        event: 'segment_membership_controller_error',
        astppId,
        detail: (error as Error).message,
      }));
      return {
        success: true,
        data: { astppId, memberships: [], primarySegment: null },
      };
    }
  }
}
