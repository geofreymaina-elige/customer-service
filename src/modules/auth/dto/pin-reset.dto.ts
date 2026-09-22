import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class InitiatePinResetDto {
  @IsNotEmpty()
  @IsString()
  astppId: string;

  @IsNotEmpty()
  @IsString()
  idNumber: string;
}

export class VerifyResetOtpDto {
  @IsNotEmpty()
  @IsString()
  resetId: string;

  @IsNotEmpty()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'OTP must be exactly 6 digits' })
  otp: string;
}

export class ResendResetOtpDto {
  @IsNotEmpty()
  @IsString()
  resetId: string;
}

export class CompletePinResetDto {
  @IsNotEmpty()
  @IsString()
  resetId: string;

  @IsNotEmpty()
  @IsString()
  @Matches(/^\d{4}$/, { message: 'PIN must be exactly 4 digits' })
  pin: string;

  @IsNotEmpty()
  @IsString()
  @Matches(/^\d{4}$/, { message: 'Confirm PIN must be exactly 4 digits' })
  confirmPin: string;
}
