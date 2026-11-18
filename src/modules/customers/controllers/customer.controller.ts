import { Controller, Get, Patch, Post, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import {
  ApiBody,
  ApiExcludeEndpoint,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { CustomerService } from '../services/customer.service';
import { AccountValidationDto, UpdateCustomerProfileDto } from '../dto/customer.dto';
import { AuthGuard } from '../../../core/auth/auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../../core/auth/current-user.decorator';
import { SasaPayWaasService } from '../../onboarding/services/sasapay-waas.service';

@ApiTags('Wallet Balance')
@Controller('api/v2/customers')
export class CustomerController {
  constructor(
    private readonly customerService: CustomerService,
    private readonly sasapayWaas: SasaPayWaasService,
  ) {}

  @Post('account-validation')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @ApiTags('SasaPay')
  @ApiOperation({
    summary: 'Validate a mobile money or bank account',
    description: `Validates the account with SasaPay using this service's configured merchant code.

Supported channel codes include \`0\` (SasaPay), \`63902\` (Safaricom), \`63903\` (Airtel Money), \`63907\` (T-Kash), \`HALOPESA\`, \`TIGO\`, \`VODACOM\`, and \`AIRTELMONEYTZ\`. Bank channel codes are also supported.

Requires both the service API key and a valid customer JWT.`,
  })
  @ApiBody({ type: AccountValidationDto })
  @ApiSecurity('API-Key')
  @ApiSecurity('AppAccessToken')
  @ApiResponse({
    status: 200,
    description: 'SasaPay account validation result.',
    schema: {
      example: {
        success: true,
        data: {
          status: true,
          responseCode: '0',
          message: 'Account Validation Results',
          account_details: {
            channel_code: '0',
            channel_name: 'SasaPay',
            account_number: '254712345678',
            account_name: 'ALEX DOE',
            account_type: 1,
          },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized - Invalid or expired JWT token.' })
  async validateAccount(@Body() dto: AccountValidationDto) {
    return {
      success: true,
      data: await this.sasapayWaas.validateAccount(dto),
    };
  }

  @Post('voip-account-validation')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @ApiTags('SasaPay')
  @ApiOperation({
    summary: 'Validate the authenticated customer VoIP account',
    description: `Looks up the authenticated customer's JWT-bound VoIP number in the customers table and returns the registered first and last name.

This is a local lookup; it does not call SasaPay. Requires both the service API key and a valid customer JWT. No request body is required.`,
  })
  @ApiSecurity('API-Key')
  @ApiSecurity('AppAccessToken')
  @ApiResponse({
    status: 200,
    description: 'Local VoIP account validation result.',
    schema: {
      example: {
        success: true,
        data: {
          status: true,
          responseCode: '0',
          message: 'Account Validation Results',
          account_details: {
            channel_code: 'LOCAL_VOIP',
            channel_name: 'Ambia VoIP',
            account_number: '254700000001',
            account_name: 'Alex Doe',
            account_type: 1,
          },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized - Invalid or expired JWT token.' })
  @ApiResponse({ status: 404, description: 'No customer is registered with this VoIP number.' })
  async validateVoipAccount(@CurrentUser() user: AuthenticatedUser) {
    return {
      success: true,
      data: await this.customerService.validateVoipAccount(user.id, user.voipNumber),
    };
  }

  @ApiExcludeEndpoint()
  @Get('me')
  @UseGuards(AuthGuard)
  async getMyProfile(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.customerService.getProfile(user.id);
    return {
      success: true,
      data,
    };
  }

  @ApiExcludeEndpoint()
  @Patch('me')
  @UseGuards(AuthGuard)
  async updateMyProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateCustomerProfileDto) {
    const data = await this.customerService.updateProfile(user.id, dto);
    return {
      success: true,
      data,
    };
  }
}
