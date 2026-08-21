import { Controller, Get, Post, Body, Param, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { CustomerOperationsService } from '../services/customer-operations.service';
import {
  CustomerQueryDto,
  UpdateCustomerStatusDto,
  ReviewKycDto,
  AdminUnlockPinDto,
  AdminFreezeWalletDto,
} from '../dto/customer-operations.dto';

@Controller('api/v1/operations')
export class OperationsController {
  constructor(private readonly operationsService: CustomerOperationsService) {}

  @Get('customers')
  async searchCustomers(@Query() query: CustomerQueryDto) {
    const data = await this.operationsService.searchCustomers(query);
    return {
      success: true,
      data,
    };
  }

  @Get('customers/:uuid')
  async getCustomerDetails(@Param('uuid') uuid: string) {
    const data = await this.operationsService.getCustomerAdminDetails(uuid);
    return {
      success: true,
      data,
    };
  }

  @Post('customers/:uuid/status')
  @HttpCode(HttpStatus.OK)
  async updateStatus(@Param('uuid') uuid: string, @Body() dto: UpdateCustomerStatusDto) {
    return this.operationsService.updateCustomerStatus(uuid, dto);
  }

  @Post('customers/:uuid/kyc/review')
  @HttpCode(HttpStatus.OK)
  async reviewKyc(@Param('uuid') uuid: string, @Body() dto: ReviewKycDto) {
    return this.operationsService.reviewKyc(uuid, dto);
  }

  @Post('customers/:uuid/pin/unlock')
  @HttpCode(HttpStatus.OK)
  async unlockPin(@Param('uuid') uuid: string, @Body() dto: AdminUnlockPinDto) {
    return this.operationsService.unlockPin(uuid, dto);
  }

  @Post('customers/:uuid/wallet/freeze')
  @HttpCode(HttpStatus.OK)
  async freezeWallet(@Param('uuid') uuid: string, @Body() dto: AdminFreezeWalletDto) {
    return this.operationsService.freezeWallet(uuid, dto);
  }
}
