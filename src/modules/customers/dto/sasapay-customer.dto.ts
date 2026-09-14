import { IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';

export enum SasaPayDocumentType {
  NATIONAL_ID = '1',
  PASSPORT = '2',
  ALIEN_ID = '3',
}

export class UpdateSasaPayCustomerDto {
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  middleName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsEnum(SasaPayDocumentType)
  documentType?: SasaPayDocumentType;

  @IsOptional()
  @IsString()
  documentNumber?: string;

  @IsOptional()
  @IsString()
  callbackUrl?: string;
}