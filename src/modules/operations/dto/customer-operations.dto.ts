import { IsNotEmpty, IsString, IsOptional, IsEnum, IsIn, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CustomerQueryDto {
  @IsOptional()
  @IsString()
  query?: string; // Search across phone, VoIP DID, ID document, email, or name

  @IsOptional()
  @IsIn(['active', 'suspended'])
  status?: string;

  @IsOptional()
  @IsIn(['unverified', 'pending', 'processing', 'requires_kyc_upload', 'approved', 'rejected'])
  kycStatus?: string;

  @IsOptional()
  @IsString()
  sasapayAccountStatus?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}

export class UpdateCustomerStatusDto {
  @IsNotEmpty({ message: 'Customer status is required.' })
  @IsIn(['active', 'suspended'], {
    message: 'Status must be active or suspended.',
  })
  status: 'active' | 'suspended';

  @IsNotEmpty({ message: 'Reason for status update is required.' })
  @IsString()
  reason: string;

  @IsOptional()
  @IsString()
  operatorId?: string;
}

export class ReviewKycDto {
  @IsNotEmpty({ message: 'Decision is required (approved, rejected, or requires_kyc_upload).' })
  @IsIn(['approved', 'rejected', 'requires_kyc_upload'], {
    message: 'Decision must be approved, rejected, or requires_kyc_upload.',
  })
  decision: 'approved' | 'rejected' | 'requires_kyc_upload';

  @IsOptional()
  @IsString()
  rejectionReason?: string;

  @IsOptional()
  @IsString()
  reviewerNotes?: string;

  @IsOptional()
  @IsString()
  tierLevel?: string;

  @IsOptional()
  @IsString()
  operatorId?: string;
}

export class AdminUnlockPinDto {
  @IsNotEmpty({ message: 'Reason for unlocking PIN is required.' })
  @IsString()
  reason: string;

  @IsOptional()
  @IsString()
  operatorId?: string;
}

export class AdminFreezeWalletDto {
  @IsNotEmpty({ message: 'Freeze action is required (freeze or unfreeze).' })
  @IsIn(['freeze', 'unfreeze'])
  action: 'freeze' | 'unfreeze';

  @IsNotEmpty({ message: 'Reason is required.' })
  @IsString()
  reason: string;

  @IsOptional()
  @IsString()
  operatorId?: string;
}
