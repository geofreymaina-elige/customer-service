import { IsNotEmpty, IsString, Matches, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class DeviceDto {
  @IsNotEmpty()
  @IsString()
  device_identifier: string;

  @IsNotEmpty()
  @IsString()
  device_model: string;

  @IsNotEmpty()
  @IsString()
  mobile_type: string;

  @IsOptional()
  @IsString()
  device_os?: string;

  @IsOptional()
  @IsString()
  app_version?: string;
}

export class SetPinDto {
  @IsNotEmpty()
  @IsString()
  astpp_id: string; // Customer ASTPP ID

  @IsNotEmpty()
  @IsString()
  @Matches(/^\d{4}$/, { message: 'PIN must be exactly 4 digits' })
  pin: string;

  @IsNotEmpty()
  @IsString()
  @Matches(/^\d{4}$/, { message: 'Confirm PIN must be exactly 4 digits' })
  confirmPin: string;
}

export class VerifyPinDto {
  @IsNotEmpty()
  @IsString()
  astpp_id: string;

  @IsNotEmpty()
  @IsString()
  @Matches(/^\d{4}$/, { message: 'PIN must be exactly 4 digits' })
  pin: string;

  @IsOptional()
  @IsString()
  device_identifier?: string;

  @IsOptional()
  @IsString()
  device_model?: string;

  @IsOptional()
  @IsString()
  mobile_type?: string;
}

export class ChangePinDto {
  @IsNotEmpty({ message: 'Current PIN is required.' })
  @IsString()
  @Matches(/^\d{4}$/, { message: 'Current PIN must be exactly 4 digits' })
  oldPin: string;

  @IsNotEmpty({ message: 'New PIN is required.' })
  @IsString()
  @Matches(/^\d{4}$/, { message: 'New PIN must be exactly 4 digits' })
  newPin: string;

  @IsNotEmpty({ message: 'Confirm new PIN is required.' })
  @IsString()
  @Matches(/^\d{4}$/, { message: 'Confirm new PIN must be exactly 4 digits' })
  confirmNewPin: string;
}

export class ExchangePinForTransactionTokenDto {
  @IsNotEmpty()
  @IsString()
  @Matches(/^\d{4}$/, { message: 'PIN must be exactly 4 digits' })
  pin: string;

  @IsNotEmpty()
  @ValidateNested()
  @Type(() => DeviceDto)
  device: DeviceDto;
}
