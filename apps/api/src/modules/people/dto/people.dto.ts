import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

const toBool = ({ value }: { value: unknown }) =>
  value === undefined || value === null || value === '' ? undefined : value === 'true' || value === true;

export class CompanyPeopleQueryDto {
  @ApiPropertyOptional({ description: 'Search person name or job title' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ description: 'Department(s), comma separated. See GET /people/taxonomy' })
  @IsOptional()
  @IsString()
  department?: string;

  @ApiPropertyOptional({ description: 'Seniority level(s), comma separated' })
  @IsOptional()
  @IsString()
  seniority?: string;

  @ApiPropertyOptional({ description: 'Decision-maker type(s), comma separated' })
  @IsOptional()
  @IsString()
  decisionMakerType?: string;

  @ApiPropertyOptional({ description: 'Only people classified as decision makers' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  decisionMakersOnly?: boolean;

  @ApiPropertyOptional({ enum: ['current', 'former', 'all'], default: 'current' })
  @IsOptional()
  @IsIn(['current', 'former', 'all'])
  status?: 'current' | 'former' | 'all';

  @ApiPropertyOptional({
    description: 'Effective verification status(es), comma separated: UNVERIFIED,PARTIALLY_VERIFIED,VERIFIED,STALE,CONFLICTED',
  })
  @IsOptional()
  @IsString()
  verification?: string;

  @ApiPropertyOptional({ description: 'Person city or state contains this text' })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional({ description: 'Only people with at least one published contact point' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  hasContact?: boolean;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class PeopleExportDto {
  @ApiPropertyOptional({ type: [String], description: 'Limit the export to these people. Locked people are always skipped.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID('all', { each: true })
  personIds?: string[];
}

export class UnlockedPeopleQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
