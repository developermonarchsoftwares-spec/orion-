import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * S-16 / F-11: the admin credit-package endpoints previously used `@Body() dto: any`, so the global
 * ValidationPipe never ran and negative prices/credits were accepted. These DTOs bound every numeric field
 * to a sane range and constrain the slug/billing-type shape.
 */
const MAX_CREDITS = 10_000_000;
const MAX_PRICE_INR = 100_000_000; // in paise-free whole rupees

export class CreateCreditPackageDto {
  @ApiProperty({ example: 'starter' })
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/, {
    message: 'slug must be lowercase alphanumeric with hyphens',
  })
  slug!: string;

  @ApiProperty({ example: 'Starter Pack' })
  @IsString()
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ description: 'Price in whole INR. Null for custom/enterprise.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE_INR)
  priceInr?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE_INR)
  priceAnnualInr?: number | null;

  @ApiProperty({ example: 100 })
  @IsInt()
  @Min(0)
  @Max(MAX_CREDITS)
  credits!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  userLimit?: number | null;

  @ApiPropertyOptional({ example: 'ONE_TIME' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z_]{2,30}$/)
  billingType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  popular?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  badgeText?: string | null;
}

export class UpdateCreditPackageDto extends PartialType(CreateCreditPackageDto) {}
