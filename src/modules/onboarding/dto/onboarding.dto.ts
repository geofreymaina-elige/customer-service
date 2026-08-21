import { IsNotEmpty, IsString, IsIn, IsOptional, IsEmail, Matches } from 'class-validator';

export class OnboardUserDeviceDto {
  @IsNotEmpty()
  @IsString()
  astpp_id: string;

  @IsNotEmpty()
  @IsString()
  device_identifier: string;

  @IsNotEmpty()
  @IsString()
  device_model: string;

  @IsNotEmpty()
  @IsString()
  device_os: string;

  @IsNotEmpty()
  @IsString()
  @IsIn(['android', 'ios'])
  mobile_type: 'android' | 'ios';

  @IsNotEmpty()
  @IsString()
  app_version: string;

  @IsOptional()
  @IsString()
  callkit_token?: string;

  @IsOptional()
  @IsString()
  apns_token?: string;
}

export class PersonalOnboardingDto {
  @IsNotEmpty()
  @IsString()
  firstName: string;

  @IsOptional()
  @IsString()
  middleName?: string;

  @IsNotEmpty()
  @IsString()
  lastName: string;

  @IsNotEmpty()
  @IsString()
  countryCode: string; // e.g. "254"

  @IsNotEmpty()
  @IsString()
  mobileNumber: string;

  @IsNotEmpty()
  @IsString()
  @IsIn(['1', '2', '3']) // "1" (ID card), "2" (Passport), "3" (Alien ID)
  documentType: string;

  @IsNotEmpty()
  @IsString()
  documentNumber: string;

  @IsNotEmpty()
  @IsEmail()
  email: string;
}

export class PersonalOnboardingConfirmDto {
  @IsNotEmpty()
  @IsString()
  requestId: string;

  @IsNotEmpty()
  @IsString()
  otp: string;
}

export class SasaPayOnboardingCallbackDto {
  @IsNotEmpty()
  @IsString()
  merchantCode: string;

  @IsNotEmpty()
  @IsString()
  accountNumber: string;

  @IsNotEmpty()
  @IsString()
  accountStatus: 'APPROVED' | 'REJECTED';

  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsString()
  description?: string;
}
