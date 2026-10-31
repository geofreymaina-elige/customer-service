import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { AdminApiKeyGuard } from '../../core/auth/admin-api-key.guard';
import { Public } from '../../core/auth/public.decorator';
import { SegmentMembershipService } from './segment-membership.service';

@ApiExcludeController()
@Public()
@UseGuards(AdminApiKeyGuard)
@Controller('api/v1/admin/segments')
export class SegmentMembershipController {
  constructor(private readonly segmentMembershipService: SegmentMembershipService) {}

  @Get('customers/:astppId/memberships')
  async getMemberships(@Param('astppId') astppId: string) {
    const data = await this.segmentMembershipService.getMemberships(astppId);
    return {
      success: true,
      data,
    };
  }
}
