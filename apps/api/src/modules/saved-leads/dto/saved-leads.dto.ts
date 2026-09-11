import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsArray,
  IsUUID,
  IsNumber,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SaveLeadDto {
  @ApiProperty({ description: 'Business UUID to save as lead' })
  @IsUUID()
  @IsNotEmpty()
  businessId!: string;

  @ApiPropertyOptional({ example: 'High potential prospect for Q4 expansion' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ example: 'NEW', description: 'Pipeline stage: NEW, CONTACTED, QUALIFIED, CONVERTED, ARCHIVED' })
  @IsOptional()
  @IsString()
  pipelineStage?: string;

  @ApiPropertyOptional({ example: ['Tech', 'High Value', 'Followup Required'], type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class UpdateSavedLeadDto {
  @ApiPropertyOptional({ example: 'Updated call notes from discussion' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ example: 'CONTACTED' })
  @IsOptional()
  @IsString()
  pipelineStage?: string;

  @ApiPropertyOptional({ example: ['Priority'], type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class BulkSaveLeadsDto {
  @ApiProperty({ description: 'Array of Business UUIDs to save', type: [String] })
  @IsArray()
  @IsUUID('all', { each: true })
  @IsNotEmpty()
  businessIds!: string[];

  @ApiPropertyOptional({ example: 'NEW' })
  @IsOptional()
  @IsString()
  pipelineStage?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class BulkDeleteLeadsDto {
  @ApiProperty({ description: 'Array of Saved Lead UUIDs or Business UUIDs to remove', type: [String] })
  @IsArray()
  @IsUUID('all', { each: true })
  @IsNotEmpty()
  leadIds!: string[];
}

export class QuerySavedLeadsDto {
  @ApiPropertyOptional({ description: 'Filter by pipeline stage' })
  @IsOptional()
  @IsString()
  stage?: string;

  @ApiPropertyOptional({ description: 'Filter by tag' })
  @IsOptional()
  @IsString()
  tag?: string;

  @ApiPropertyOptional({ description: 'Search notes or business name' })
  @IsOptional()
  @IsString()
  search?: string;

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
  limit?: number = 20;
}
