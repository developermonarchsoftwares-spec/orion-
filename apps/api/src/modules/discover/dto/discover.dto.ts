import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsNumber,
  IsInt,
  IsBoolean,
  Min,
  Max,
  MaxLength,
  Matches,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class DiscoverSearchQueryDto {
  @ApiPropertyOptional({ description: 'Search keyword for name, category, or location' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional({ description: 'Industry UUID filter' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  industryId?: string;

  @ApiPropertyOptional({ description: 'Category UUID filter' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  categoryId?: string;

  @ApiPropertyOptional({ description: 'Business Type (e.g. PRIVATE_LIMITED, LLP)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  businessType?: string;

  @ApiPropertyOptional({ description: 'MSME Category (e.g. MICRO, SMALL, MEDIUM)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  msmeCategory?: string;

  @ApiPropertyOptional({ description: 'State / Province' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string;

  @ApiPropertyOptional({ description: 'District' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  district?: string;

  @ApiPropertyOptional({ description: 'City' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({ description: 'Pincode / Postal Code' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
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

  @ApiPropertyOptional({ description: 'Decision-maker type(s), comma separated, e.g. FOUNDER_CEO,PROCUREMENT_DECISION_MAKER' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  decisionMakerType?: string;

  @ApiPropertyOptional({ description: 'Only companies with a current published decision maker' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  hasDecisionMaker?: boolean;

  @ApiPropertyOptional({ description: 'Only companies with a verified (evidence-backed) decision maker' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  hasVerifiedDecisionMaker?: boolean;

  @ApiPropertyOptional({ description: 'Only companies whose decision maker has a published contact point' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  hasDecisionMakerContact?: boolean;

  @ApiPropertyOptional({ description: 'Opportunity Tier: HIGH, MEDIUM, LOW, NONE' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
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
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9_:,]+$/, { message: 'sortBy may only contain letters, digits, underscore, colon and comma' })
  sortBy?: string;

  @ApiPropertyOptional({ description: 'Page number (default: 1)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Number of items per page (default: 20, max: 100)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Cursor token for pagination' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  cursor?: string;
}

export class DiscoverSuggestionsDto {
  @ApiPropertyOptional({ description: 'Prefix query for autocomplete search' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}
