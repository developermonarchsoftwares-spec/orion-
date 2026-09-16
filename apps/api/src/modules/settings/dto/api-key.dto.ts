import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsArray, IsOptional, IsNumber, Min, Max, Length } from 'class-validator';

export class CreateApiKeyDto {
  @ApiProperty({ description: 'Human-readable identifier for the API key', example: 'Production Lead Enrichment Key' })
  @IsString()
  @IsNotEmpty()
  @Length(2, 100)
  name!: string;

  @ApiPropertyOptional({ description: 'Permission scopes granted to key', example: ['read', 'search'], type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  scopes?: string[];

  @ApiPropertyOptional({ description: 'Validity duration in days (optional)', example: 90 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(365)
  expiresInDays?: number;
}
