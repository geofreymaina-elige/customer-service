import { IsOptional, IsString, IsEmail, IsEnum, IsNotEmpty, IsInt, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AccountValidationDto {
  @ApiProperty({
    description: 'SasaPay channel or bank code.',
    example: '0',
  })
  @IsNotEmpty()
  @IsString()
  channelCode: string;

  @ApiProperty({
    description: 'Mobile number, bank account number, or Paybill/Till account reference.',
    example: '254712345678',
  })
  @IsNotEmpty()
  @IsString()
  accountNumber: string;

  @ApiPropertyOptional({
    description: 'Account type: 0 SasaPay, 1 mobile (default), 3 M-PESA Paybill, 4 M-PESA Till, 5 bank.',
    enum: [0, 1, 3, 4, 5],
    example: 1,
  })
  @IsOptional()
  @IsInt()
  @IsIn([0, 1, 3, 4, 5])
  accountType?: number;
}

export class UpdateCustomerProfileDto {
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  timezone?: string;
}

export enum DocumentTypeEnum {
  NATIONAL_ID = 'NATIONAL_ID',
  PASSPORT = 'PASSPORT',
  ALIEN_CARD = 'ALIEN_CARD',
  SERVICE_CARD = 'SERVICE_CARD',
}

export class SubmitKycDocumentsDto {
  @IsNotEmpty({ message: 'Document type is required.' })
  @IsEnum(DocumentTypeEnum, { message: 'Document type must be NATIONAL_ID, PASSPORT, ALIEN_CARD, or SERVICE_CARD.' })
  documentType: DocumentTypeEnum;

  @IsNotEmpty({ message: 'Document number is required.' })
  @IsString()
  documentNumber: string;

  @IsOptional()
  @IsString()
  issuingCountry?: string;

  @IsOptional()
  @IsString()
  passportPhotoUrl?: string;

  @IsNotEmpty({ message: 'Front document image URL is required.' })
  @IsString()
  docFrontUrl: string;

  @IsOptional()
  @IsString()
  docBackUrl?: string;
}
