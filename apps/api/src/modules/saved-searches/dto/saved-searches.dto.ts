import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsBoolean,
  IsObject,
  MaxLength,
} from 'class-validator';

export class CreateSavedSearchDto {
  @ApiProperty({ example: 'Bangalore Tech Startups', description: 'Name of the search' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name!: string;

  @ApiProperty({ description: 'Filter object containing criteria' })
  @IsObject()
  @IsNotEmpty()
  filters!: Record<string, unknown>;

  @ApiPropertyOptional({ default: false, description: 'Enable email alert notifications for new matches' })
  @IsOptional()
  @IsBoolean()
  alertEnabled?: boolean;

  @ApiPropertyOptional({ default: 'DAILY', description: 'Alert frequency: DAILY, WEEKLY, REALTIME' })
  @IsOptional()
  @IsString()
  alertFrequency?: string;
}

export class UpdateSavedSearchDto {
  @ApiPropertyOptional({ example: 'Updated Search Title' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @ApiPropertyOptional({ description: 'Updated filter object' })
  @IsOptional()
  @IsObject()
  filters?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Toggle alert notification' })
  @IsOptional()
  @IsBoolean()
  alertEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Alert frequency' })
  @IsOptional()
  @IsString()
  alertFrequency?: string;
}
