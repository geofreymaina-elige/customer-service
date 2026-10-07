import {
  Controller,
  Get,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { AdminApiKeyGuard } from '../../../core/auth/admin-api-key.guard';
import { Public } from '../../../core/auth/public.decorator';
import { AdminSasaPayKycService } from '../services/admin-sasapay-kyc.service';

@ApiExcludeController()
@Controller('api/v2/admin/sasapay-kyc')
@Public()
@UseGuards(AdminApiKeyGuard)
export class AdminSasaPayKycController {
  constructor(private readonly adminKycService: AdminSasaPayKycService) {}

  /**
   * Get complete KYC submission dossier with image URLs
   * Returns Customer details, Application details with KYC status,
   * SasaPay KYC submission, and Document image URLs.
   * GET /api/v2/admin/sasapay-kyc/customers/:astppId
   */
  @Get('customers/:astppId')
  async getSubmissionDetails(@Param('astppId') astppId: string) {
    const data = await this.adminKycService.getSubmissionDetailsByAstppId(astppId);
    return {
      success: true,
      data,
    };
  }
}
