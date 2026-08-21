import { IsNotEmpty, IsOptional, IsString, Length, Matches } from 'class-validator';

export class LockWalletDto {
  @IsNotEmpty({ message: 'Lock reason is required.' })
  @IsString()
  reason: string;

  @IsOptional()
  @IsString()
  @Length(4, 4, { message: 'PIN must be 4 digits if provided.' })
  @Matches(/^[0-9]{4}$/, { message: 'PIN must contain digits only.' })
  pin?: string;
}

export class UnlockWalletDto {
  @IsNotEmpty({ message: 'Security PIN is required to unlock account.' })
  @IsString()
  @Length(4, 4, { message: 'PIN must be 4 digits.' })
  @Matches(/^[0-9]{4}$/, { message: 'PIN must contain digits only.' })
  pin: string;
}
