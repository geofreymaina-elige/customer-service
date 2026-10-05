import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  Req,
  Res,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { AdminApiKeyGuard } from '../../../core/auth/admin-api-key.guard';
import { AdminSasaPayKycService } from '../services/admin-sasapay-kyc.service';
import {
  AdminReviewDecisionDto,
  AdminKycSubmissionsQueryDto,
} from '../dto/admin-sasapay-kyc.dto';

@Controller('api/v2/admin/sasapay-kyc')
@UseGuards(AdminApiKeyGuard)
export class AdminSasaPayKycController {
  constructor(private readonly adminKycService: AdminSasaPayKycService) {}

  /**
   * Search / List SasaPay KYC submissions queue for review
   * GET /api/v2/admin/sasapay-kyc/submissions
   */
  @Get('submissions')
  async listSubmissions(@Query() query: AdminKycSubmissionsQueryDto) {
    const data = await this.adminKycService.listSubmissions(query);
    return {
      success: true,
      data,
    };
  }

  /**
   * Get complete KYC submission dossier
   * Returns Customer details, Application details with KYC status,
   * SasaPay KYC submission, and Document images with full URLs.
   * GET /api/v2/admin/sasapay-kyc/submissions/:submissionId
   */
  @Get('submissions/:submissionId')
  async getSubmissionDetails(@Param('submissionId') submissionId: string) {
    const data = await this.adminKycService.getSubmissionDetails(submissionId);
    return {
      success: true,
      data,
    };
  }

  /**
   * Get KYC details and submissions for a customer by ASTPP account ID
   * GET /api/v2/admin/sasapay-kyc/customers/:astppId
   */
  @Get('customers/:astppId')
  async getCustomerKycByAstppId(@Param('astppId', ParseIntPipe) astppId: number) {
    const data = await this.adminKycService.getCustomerKycByAstppId(astppId);
    return {
      success: true,
      data,
    };
  }

  /**
   * Securely view / download a KYC document image by ID
   * GET /api/v2/admin/sasapay-kyc/files/:imageId
   */
  @Get('files/:imageId')
  async getKycImageFile(
    @Param('imageId', ParseIntPipe) imageId: number,
    @Res() res: Response,
  ) {
    const fileData = await this.adminKycService.getImageFile(imageId);

    res.setHeader('Content-Type', fileData.mimeType);
    res.setHeader('Content-Length', fileData.fileSizeBytes);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(fileData.filename)}"`,
    );
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    fileData.stream.pipe(res);
  }

  /**
   * Submit an Admin Review Decision (Approve / Reject)
   * POST /api/v2/admin/sasapay-kyc/submissions/:submissionId/review-decision
   */
  @Post('submissions/:submissionId/review-decision')
  @HttpCode(HttpStatus.OK)
  async submitReviewDecision(
    @Param('submissionId') submissionId: string,
    @Body() dto: AdminReviewDecisionDto,
    @Req() req: any,
  ) {
    const adminActor = req.admin?.adminUserId || 'admin-system';
    const data = await this.adminKycService.submitReviewDecision(
      submissionId,
      dto,
      adminActor,
    );

    return {
      success: true,
      message: `KYC submission ${submissionId} has been marked as ${dto.decision}.`,
      data,
    };
  }
}
