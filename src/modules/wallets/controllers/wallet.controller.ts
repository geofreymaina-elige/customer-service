import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity, ApiQuery } from '@nestjs/swagger';
import { WalletService } from '../services/wallet.service';
import { AuthGuard } from '../../../core/auth/auth.guard';
import { JwtScopes } from '../../../core/auth/jwt.service';
import { RequireScopes } from '../../../core/auth/scopes.decorator';
import { AstppTokenGuard } from '../../../core/auth/astpp-token.guard';
import { CurrentUser, AuthenticatedUser } from '../../../core/auth/current-user.decorator';

@ApiTags('1. Onboarding')
@Controller('api/v2/customers')
export class WalletController {
  constructor(
    private readonly walletService: WalletService,
  ) {}

  @Get('me')
  @ApiTags('5. Wallet')
  @ApiOperation({
    summary: 'Get wallet information',
    description: `Get detailed wallet information for the authenticated customer.

**Purpose** Retrieve wallet details, status, and account information.

**Authentication** X-API-Key + Bearer (App Access Token)

**Use Case** Display wallet information on home screen or profile page.`
  })
  @ApiSecurity('API-Key')
  @ApiSecurity('AppAccessToken')
  @ApiResponse({
    status: 200,
    description: 'Wallet information retrieved successfully',
    schema: {
      example: {
        success: true,
        data: {
          walletId: '7aba4cc8-d917-40d7-a73e-31b25891697c',
          accountNumber: '1862533',
          currency: 'KES',
          status: 'active',
          createdAt: '2026-09-18T08:57:56.796Z'
        }
      }
    }
  })
  @ApiResponse({ status: 401, description: 'Unauthorized - Invalid or missing token' })
  @UseGuards(AuthGuard)
  async getMyWallet(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.walletService.getWalletByCustomerId(user.id);
    return {
      success: true,
      data,
    };
  }

  @Get('onboarding-status')
  @ApiOperation({
    summary: '🚀 Check customer onboarding status (CALL THIS FIRST)',
    description: `**CRITICAL:** Call this endpoint EVERY TIME the app launches to determine what screen to show.

**Purpose** 
Determines the customer's current onboarding state and returns the next action they need to take.

**Workflow Decision Tree**
- \`nextAction: "start_onboarding"\` → Customer has no wallet, call POST /sessions/device
- \`nextAction: "verify_otp"\` → Wallet creation initiated, show OTP verification screen
- \`nextAction: "upload_kyc_documents"\` → Wallet active but pending KYC approval
- \`nextAction: "set_pin"\` → Wallet approved but PIN not set
- \`nextAction: "make_transaction"\` → Fully onboarded, show home screen

**Authentication** X-API-Key + X-Astpp-Token

**ASTPP Token** Must be the encrypted token from ASTPP system for this customer.`
  })
  @ApiSecurity('API-Key')
  @ApiSecurity('ASTPP-Token')
  @ApiQuery({
    name: 'astppId',
    required: true,
    type: 'string',
    description: 'ASTPP Account ID for the customer',
    example: '31553'
  })
  @ApiResponse({
    status: 200,
    description: 'Onboarding status retrieved successfully',
    schema: {
      oneOf: [
        {
          description: 'Fully Onboarded Customer',
          example: {
            success: true,
            data: {
              applicationStatus: 'approved',
              wallet: {
                walletId: '7aba4cc8-d917-40d7-a73e-31b25891697c',
                accountNumber: '1862533',
                currency: 'KES',
                status: 'active',
                createdAt: '2026-09-18T08:57:56.796Z'
              },
              application: {
                sasapayRequestId: '00536e58-24ae-4288-bd1a-440b0ca67f70',
                sasapayAccountNumber: '1862624',
                sasapayAccountStatus: 'ACTIVE',
                submittedAt: '2026-09-18T08:48:02.692Z',
                approvedAt: '2026-07-23T12:22:42.000Z',
                rejectedAt: null
              },
              requiredDocuments: [],
              nextAction: {
                type: 'make_transaction'
              }
            }
          }
        },
        {
          description: 'Wallet Created, Pending KYC Approval',
          example: {
            success: true,
            data: {
              applicationStatus: 'pending',
              wallet: {
                walletId: '1a9fe575-500d-444f-99bd-90a22977639c',
                accountNumber: '1881181',
                currency: 'KES',
                status: 'active',
                createdAt: '2026-09-23T12:59:25.937Z'
              },
              application: {
                sasapayRequestId: '7ca09f78-4378-4c65-91bb-dc2cad8f3a8a',
                sasapayAccountNumber: '1881181',
                sasapayAccountStatus: 'ACTIVE',
                submittedAt: '2026-09-23T12:59:58.274Z',
                approvedAt: null,
                rejectedAt: null
              },
              requiredDocuments: [],
              nextAction: {
                type: 'upload_kyc_documents',
                message: 'Wallet created. Please upload KYC documents for approval.'
              }
            }
          }
        },
        {
          description: 'OTP Verification Pending',
          example: {
            success: true,
            data: {
              applicationStatus: 'pending',
              wallet: null,
              application: null,
              requiredDocuments: [],
              nextAction: {
                type: 'verify_otp'
              }
            }
          }
        }
      ]
    }
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Missing or invalid API Key or ASTPP Token',
    schema: {
      example: {
        success: false,
        message: 'Missing required X-API-Key header.',
        code: 'MISSING_API_KEY'
      }
    }
  })
  @ApiResponse({
    status: 404,
    description: 'Customer not found',
    schema: {
      example: {
        success: false,
        message: 'Customer not found.',
        code: 'NOT_FOUND'
      }
    }
  })
  @UseGuards(AstppTokenGuard)
  async getWalletOnboardingStatus(@Query('astppId') astppId: string) {
    const data = await this.walletService.getWalletOnboardingStatusByAstppId(astppId);
    return {
      success: true,
      data,
    };
  }

  @Get('me/balance')
  @ApiTags('5. Wallet')
  @ApiOperation({
    summary: '💰 Get wallet balance',
    description: `Get current wallet balance for the authenticated customer.

**Purpose** Display current balance in the wallet.

**Authentication** X-API-Key + Bearer (Transaction Token)

**IMPORTANT** This endpoint requires a transaction token (10-minute validity).
You must call POST /auth/transaction-tokens (with PIN verification) first to get the transaction token.

**Use Case** Display balance on home screen after PIN verification.`
  })
  @ApiSecurity('API-Key')
  @ApiSecurity('TransactionToken')
  @ApiResponse({
    status: 200,
    description: 'Balance retrieved successfully',
    schema: {
      example: {
        success: true,
        data: {
          balance: 1250.50,
          currency: 'KES',
          accountNumber: '1862533'
        }
      }
    }
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or expired transaction token',
    schema: {
      example: {
        success: false,
        message: 'Transaction token required. Please verify your PIN.',
        code: 'UNAUTHORIZED'
      }
    }
  })
  @UseGuards(AuthGuard)
  @RequireScopes(JwtScopes.Transaction)
  async getMyBalance(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.walletService.getBalance(user.id);
    return {
      success: true,
      data,
    };
  }
}
