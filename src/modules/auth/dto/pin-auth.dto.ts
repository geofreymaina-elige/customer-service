import { IsNotEmpty, IsString, Matches, IsOptional } from 'class-validator';

export class SetPinDto {
  @IsNotEmpty()
  @IsString()
  customerId: string; // Customer UUID or ASTPP ID

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
  customerId: string;

  @IsNotEmpty()
  @IsString()
  @Matches(/^\d{4}$/, { message: 'PIN must be exactly 4 digits' })
  pin: string;

  @IsOptional()
  @IsString()
  deviceIdentifier?: string;

  @IsOptional()
  @IsString()
  deviceModel?: string;

  @IsOptional()
  @IsString()
  mobileType?: string;
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
