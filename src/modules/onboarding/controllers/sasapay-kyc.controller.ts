import {
  Controller,
  Get,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { AuthGuard } from '../../../core/auth/auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../../core/auth/current-user.decorator';
import { SasaPayKycService, UploadedKycFile } from '../services/sasapay-kyc.service';

@ApiTags('KYC')
@Controller('api/v2/customers/kyc')
@UseGuards(AuthGuard)
@ApiBearerAuth('JWT')
export class SasaPayKycController {
  constructor(private readonly sasaPayKyc: SasaPayKycService) {}

  @Get('requirements')
  @ApiOperation({
    summary: 'Get all document requirements',
    description: `
Returns all available KYC document types and their requirements.

**Use this to**
- Show customer which document types they can submit
- Display requirements for each document type
- Build document selection UI

**Document Types**
- \`national_id\` - Kenya National ID Card
- \`passport\` - International Passport
- \`alien_id\` - Alien Registration Card

**Each document type requires**
- document_front (front of ID/passport)
- document_back (back of ID/passport)
- selfie (passport photo/selfie)

**Accepted Formats** JPEG, PNG, WebP  
**Max File Size** 20MB per image
    `,
  })
  @ApiResponse({
    status: 200,
    description: 'List of all document types with requirements',
    schema: {
      example: {
        success: true,
        data: [
          {
            documentType: 'national_id',
            policyVersion: 1,
            requiredDocuments: ['document_front', 'document_back', 'selfie'],
            acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
            maxFileSizeBytes: 20971520
          },
          {
            documentType: 'passport',
            policyVersion: 1,
            requiredDocuments: ['document_front', 'document_back', 'selfie'],
            acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
            maxFileSizeBytes: 20971520
          },
          {
            documentType: 'alien_id',
            policyVersion: 1,
            requiredDocuments: ['document_front', 'document_back', 'selfie'],
            acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
            maxFileSizeBytes: 20971520
          }
        ]
      }
    }
  })
  @ApiResponse({ status: 401, description: 'Unauthorized - Invalid or expired JWT token' })
  @ApiResponse({ status: 403, description: 'Forbidden - SasaPay KYC feature is disabled' })
  @ApiResponse({ status: 429, description: 'Too Many Requests - Rate limit exceeded' })
  async getRequirements(@CurrentUser() user: AuthenticatedUser) {
    return {
      success: true,
      data: await this.sasaPayKyc.getAllDocumentRequirements(),
    };
  }

  @Get('submissions/status')
  @ApiOperation({
    summary: 'Get current KYC submission status',
    description: `
Returns the customer's current KYC status with prioritized data.

**KYC Source Priority** (highest to lowest)
1. \`sasapay_kyc\` - SasaPay KYC submission (if exists)
2. \`wallet_kyc\` - Wallet KYC from secondary verification
3. \`primary_kyc\` - Initial onboarding KYC from ASTPP

**Use this to**
- Check if customer needs to submit KYC
- Show which documents are still required
- Display current submission status
- Show uploaded document previews

**Submission Status Values**
- \`awaiting_documents\` - Waiting for customer to upload documents
- \`submitted_for_review\` - All docs uploaded, pending admin review
- \`approved_for_psp\` - Admin approved, ready to send to SasaPay
- \`rejected\` - Admin rejected the submission
- \`psp_approved\` - SasaPay approved the KYC
- \`psp_rejected\` - SasaPay rejected the KYC

**Image URLs** Full URLs ready to display in app
    `,
  })
  @ApiResponse({
    status: 200,
    description: 'Current KYC status with documents',
    schema: {
      example: {
        success: true,
        data: {
          kycSource: 'sasapay_kyc',
          customer: {
            id: 6516,
            astppId: 31553
          },
          application: {
            id: 4652,
            kycStatus: 'kyc_submitted'
          },
          status: 'submitted_for_review',
          documentType: 'NATIONAL_ID',
          documents: [
            {
              type: 'document_front',
              url: 'https://api.ambiapay.com/uploads/images/4652/abc123.jpg'
            },
            {
              type: 'document_back',
              url: 'https://api.ambiapay.com/uploads/images/4652/def456.jpg'
            },
            {
              type: 'selfie',
              url: 'https://api.ambiapay.com/uploads/images/4652/ghi789.jpg'
            }
          ],
          submittedAt: '2026-10-05T12:00:00Z',
          reviewedAt: null
        }
      }
    }
  })
  @ApiResponse({ status: 401, description: 'Unauthorized - Invalid or expired JWT token' })
  @ApiResponse({ status: 404, description: 'Not Found - No KYC submission found for customer' })
  async getCurrentSubmission(@CurrentUser() user: AuthenticatedUser) {
    return {
      success: true,
      data: await this.sasaPayKyc.getAllKycStatus(user.id),
    };
  }

  @Post('submissions/images')
  @ApiOperation({
    summary: 'Upload KYC document images',
    description: `
Upload KYC document images for verification.

**Important**
- Use \`multipart/form-data\` encoding
- Field names MUST match document types \`document_front\`, \`document_back\`, \`selfie\`
- Upload all required documents for your document type
- Once all documents are uploaded, the submission is **automatically submitted for review**

**Upload Flow**
1. Get requirements from \`GET /api/v2/customers/kyc/requirements\`
2. Capture/select images from device
3. Upload images with correct field names
4. Check status with \`GET /api/v2/customers/kyc/submissions/status\`
5. System auto-submits when all docs uploaded

**Image Requirements**
- **Formats** JPEG, PNG, WebP
- **Max Size** 20MB per image
- **Max Files** 3 files per request
- **Quality** Clear, readable, well-lit photos
- **Content** Full document visible, no glare or blur

**Field Names** (use these as form field names)
- \`document_front\` - Front of ID/passport
- \`document_back\` - Back of ID/passport
- \`selfie\` - Passport photo/selfie

**Example** (using FormData in JavaScript)
\`\`\`javascript
const formData = new FormData();
formData.append('document_front', frontImage, 'id_front.jpg');
formData.append('document_back', backImage, 'id_back.jpg');
formData.append('selfie', selfieImage, 'selfie.jpg');

fetch('/api/v2/customers/kyc/submissions/images', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_JWT_TOKEN'
  },
  body: formData
});
\`\`\`
    `,
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'KYC document images (document_front, document_back, selfie)',
    schema: {
      type: 'object',
      properties: {
        document_front: {
          type: 'string',
          format: 'binary',
          description: 'Front of ID/passport (JPEG, PNG, or WebP, max 20MB)'
        },
        document_back: {
          type: 'string',
          format: 'binary',
          description: 'Back of ID/passport (JPEG, PNG, or WebP, max 20MB)'
        },
        selfie: {
          type: 'string',
          format: 'binary',
          description: 'Passport photo/selfie (JPEG, PNG, or WebP, max 20MB)'
        }
      }
    }
  })
  @ApiResponse({
    status: 200,
    description: 'Images uploaded successfully',
    schema: {
      example: {
        success: true,
        data: {
          uploadedDocuments: ['document_front', 'document_back', 'selfie'],
          submission: {
            submissionId: 12345,
            status: 'submitted_for_review',
            policyVersion: 1,
            requiredDocuments: [],
            reason: null,
            customerSubmittedAt: '2026-10-05T12:00:00Z',
            createdAt: '2026-10-05T11:00:00Z',
            updatedAt: '2026-10-05T12:00:00Z'
          }
        }
      }
    }
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Validation errors',
    schema: {
      example: {
        success: false,
        message: 'Image size exceeds the allowed limit for document_front.',
        code: 'BAD_REQUEST'
      }
    }
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or expired JWT token'
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - SasaPay KYC feature is disabled',
    schema: {
      example: {
        success: false,
        message: 'SasaPay KYC submissions are not enabled.',
        code: 'FORBIDDEN'
      }
    }
  })
  @ApiResponse({
    status: 404,
    description: 'Not Found - No active KYC submission awaiting documents',
    schema: {
      example: {
        success: false,
        message: 'No active KYC submission awaiting documents was found.',
        code: 'NOT_FOUND'
      }
    }
  })
  @ApiResponse({
    status: 409,
    description: 'Conflict - Image already uploaded for this document type',
    schema: {
      example: {
        success: false,
        message: 'An image of type document_front is already uploaded.',
        code: 'CONFLICT'
      }
    }
  })
  @ApiResponse({
    status: 413,
    description: 'Payload Too Large - File size exceeds 20MB limit'
  })
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