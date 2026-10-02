import {
  Controller,
  Get,
  Post,
  Param,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '../../../core/auth/auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../../core/auth/current-user.decorator';
import { SasaPayKycService, UploadedKycFile } from '../services/sasapay-kyc.service';

@Controller('api/v2/wallets/kyc')
@UseGuards(AuthGuard)
export class SasaPayKycController {
  constructor(private readonly sasaPayKyc: SasaPayKycService) {}

  @Get('requirements')
  async getRequirements(@CurrentUser() user: AuthenticatedUser) {
    return {
      success: true,
      data: await this.sasaPayKyc.getActiveRequirements(user.id),
    };
  }

  @Get('submissions/current')
  async getCurrentSubmission(@CurrentUser() user: AuthenticatedUser) {
    return {
      success: true,
      data: await this.sasaPayKyc.getCurrentStatus(user.id),
    };
  }

  @Post('submissions/:submissionId/images')
  @UseInterceptors(AnyFilesInterceptor({
    limits: {
      files: 3,
      fileSize: 20 * 1024 * 1024,
    },
  }))
  async uploadImages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('submissionId') submissionId: string,
    @UploadedFiles() files: UploadedKycFile[],
  ) {
    return {
      success: true,
      data: await this.sasaPayKyc.uploadImages(user.id, submissionId, files || []),
    };
  }

  @Post('submissions/:submissionId/submit')
  async submitForReview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('submissionId') submissionId: string,
  ) {
    return {
      success: true,
      data: await this.sasaPayKyc.submitForReview(user.id, submissionId),
    };
  }
}