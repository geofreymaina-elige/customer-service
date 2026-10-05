import { IsEnum, IsNotEmpty, IsOptional, IsString, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

export enum AdminReviewDecisionEnum {
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

export class AdminReviewDecisionDto {
  @IsEnum(AdminReviewDecisionEnum, { message: 'Decision must be either "approved" or "rejected"' })
  @IsNotEmpty()
  decision: AdminReviewDecisionEnum;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsString()
  @IsOptional()
  reviewerName?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class AdminKycSubmissionsQueryDto {
  @IsString()
  @IsOptional()
  status?: string;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  astppId?: number;

  @IsString()
  @IsOptional()
  query?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @IsOptional()
  limit: number = 20;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  offset: number = 0;
}
