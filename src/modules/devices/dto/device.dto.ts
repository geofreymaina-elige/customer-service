import { IsNotEmpty, IsString, IsIn, IsOptional, Matches, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class DeviceMetadataDto {
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

  @IsOptional()
  @IsString()
  fcm_token?: string;
}

export class VerifyDeviceDto extends DeviceMetadataDto {
  @IsNotEmpty()
  @IsString()
  astppId: string;
}

export class InitiateDeviceLogoutDto {
  @IsNotEmpty()
  @IsString()
  astpp_id: string;

  @IsNotEmpty()
  @IsString()
  id_number: string;

  @IsNotEmpty()
  @IsString()
  @Matches(/^\d{4}$/, { message: 'PIN must be exactly 4 digits' })
  pin: string;

  @IsNotEmpty()
  @ValidateNested()
  @Type(() => DeviceMetadataDto)
  device: DeviceMetadataDto;
}

export class VerifyDeviceLogoutDto {
  @IsNotEmpty()
  @IsString()
  sessionToken: string;

  @IsNotEmpty()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'OTP must be exactly 6 digits' })
  otp: string;

  @IsNotEmpty()
  @ValidateNested()
  @Type(() => DeviceMetadataDto)
  device: DeviceMetadataDto;
}

export class RevokeDeviceDto {
  @IsNotEmpty({ message: 'Session ID is required.' })
  @IsString()
  sessionId: string;
}
