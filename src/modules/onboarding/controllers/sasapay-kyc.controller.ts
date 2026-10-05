import {
  Controller,
  Get,
  Post,
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
      data: await this.sasaPayKyc.getAllDocumentRequirements(),
    };
  }

  @Get('submissions/current')
  async getCurrentSubmission(@CurrentUser() user: AuthenticatedUser) {
    return {
      success: true,
      data: await this.sasaPayKyc.getCurrentStatus(user.id),
    };
  }

  @Post('submissions/images')
  @UseInterceptors(AnyFilesInterceptor({
    limits: {
      files: 3,
      fileSize: 20 * 1024 * 1024,
    },
  }))
  async uploadImages(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFiles() files: UploadedKycFile[],
  ) {
    return {
      success: true,
      data: await this.sasaPayKyc.uploadImages(user.id, files || []),
    };
  }
}