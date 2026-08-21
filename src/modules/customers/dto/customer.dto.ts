import { IsOptional, IsString, IsEmail, IsEnum, IsNotEmpty } from 'class-validator';

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
