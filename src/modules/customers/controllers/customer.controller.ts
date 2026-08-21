import { Controller, Get, Patch, Post, Body, UseGuards, Query } from '@nestjs/common';
import { CustomerService } from '../services/customer.service';
import { UpdateCustomerProfileDto, SubmitKycDocumentsDto } from '../dto/customer.dto';
import { AuthGuard } from '../../../core/auth/auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../../core/auth/current-user.decorator';

@Controller('api/v1/customers')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Get('me')
  @UseGuards(AuthGuard)
  async getMyProfile(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.customerService.getProfile(user.id);
    return {
      success: true,
      data,
    };
  }

  @Patch('me')
  @UseGuards(AuthGuard)
  async updateMyProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateCustomerProfileDto) {
    const data = await this.customerService.updateProfile(user.id, dto);
    return {
      success: true,
      data,
    };
  }

  @Post('kyc/documents')
  @UseGuards(AuthGuard)
  async submitKycDocuments(@CurrentUser() user: AuthenticatedUser, @Body() dto: SubmitKycDocumentsDto) {
    const data = await this.customerService.submitKycDocuments(user.id, dto);
    return {
      success: true,
      message: data.message,
      data,
    };
  }

  @Get('me/activity')
  @UseGuards(AuthGuard)
  async getMyActivity(@CurrentUser() user: AuthenticatedUser, @Query('limit') limit?: string) {
    const data = await this.customerService.getActivityHistory(user.id, limit ? parseInt(limit, 10) : 30);
    return {
      success: true,
      data,
    };
  }
}
