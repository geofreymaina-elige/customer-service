import { IsNotEmpty, IsString, IsIn, IsOptional, Matches, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class DeviceMetadataDto {
  @IsNotEmpty()
  @IsString()
  deviceIdentifier: string;

  @IsNotEmpty()
  @IsString()
  deviceModel: string;

  @IsNotEmpty()
  @IsString()
  deviceOs: string;

  @IsNotEmpty()
  @IsString()
  @IsIn(['android', 'ios'])
  mobileType: 'android' | 'ios';

  @IsNotEmpty()
  @IsString()
  appVersion: string;

  @IsOptional()
  @IsString()
  callkitToken?: string;

  @IsOptional()
  @IsString()
  apnsToken?: string;

  @IsOptional()
  @IsString()
  fcmToken?: string;
}

export class VerifyDeviceDto extends DeviceMetadataDto {
  @IsNotEmpty()
  @IsString()
  customerId: string;
}

export class InitiateDeviceLogoutDto {
  @IsNotEmpty()
  @IsString()
  astppId: string;

  @IsNotEmpty()
  @IsString()
  idNumber: string;

  @IsNotEmpty()
  @IsString()
  @Matches(/^\d{4}$/, { message: 'PIN must be exactly 4 digits' })
  pin: string;
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
  @IsNotEmpty({ message: 'Device UUID is required.' })
  @IsString()
  deviceUuid: string;
}
