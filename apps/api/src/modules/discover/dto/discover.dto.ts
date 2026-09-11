import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsNumber,
  IsBoolean,
  Min,
  Max,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class DiscoverSearchQueryDto {
  @ApiPropertyOptional({ description: 'Search keyword for name, category, or location' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ description: 'Industry UUID filter' })
  @IsOptional()
  @IsString()
  industryId?: string;

  @ApiPropertyOptional({ description: 'Category UUID filter' })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'Business Type (e.g. PRIVATE_LIMITED, LLP)' })
  @IsOptional()
  @IsString()
  businessType?: string;

  @ApiPropertyOptional({ description: 'MSME Category (e.g. MICRO, SMALL, MEDIUM)' })
  @IsOptional()
  @IsString()
  msmeCategory?: string;

  @ApiPropertyOptional({ description: 'State / Province' })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional({ description: 'District' })
  @IsOptional()
  @IsString()
  district?: string;

  @ApiPropertyOptional({ description: 'City' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ description: 'Pincode / Postal Code' })
  @IsOptional()
  @IsString()
  pincode?: string;

  @ApiPropertyOptional({ description: 'Filter businesses that have a verified website' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  hasWebsite?: boolean;

  @ApiPropertyOptional({ description: 'Filter businesses that have email contacts' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  hasEmail?: boolean;

  @ApiPropertyOptional({ description: 'Filter businesses that have phone contacts' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  hasPhone?: boolean;

  @ApiPropertyOptional({ description: 'Filter businesses that have GSTIN identifier' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  hasGstin?: boolean;

  @ApiPropertyOptional({ description: 'Opportunity Tier: HIGH, MEDIUM, LOW, NONE' })
  @IsOptional()
  @IsString()
  opportunityTier?: string;

  @ApiPropertyOptional({ description: 'Minimum Orion Score (0-100)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  minOrionScore?: number;

  @ApiPropertyOptional({ description: 'Maximum Orion Score (0-100)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  maxOrionScore?: number;

  @ApiPropertyOptional({ description: 'Sort criteria (e.g., orion_score:desc, created_at:desc)' })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ description: 'Page number (default: 1)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Number of items per page (default: 20, max: 100)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Cursor token for pagination' })
  @IsOptional()
  @IsString()
  cursor?: string;
}

export class DiscoverSuggestionsDto {
  @ApiPropertyOptional({ description: 'Prefix query for autocomplete search' })
  @IsOptional()
  @IsString()
  q?: string;
}
