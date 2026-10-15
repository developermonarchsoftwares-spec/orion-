import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { EXPORT_FORMATS, EXPORT_FREQUENCIES, ExportFormat, ExportFrequency } from '../export.service';

export class CreateExportDto {
  @ApiProperty({ example: 'unlocked-leads', description: 'Dataset id from GET /exports/datasets' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  dataset!: string;

  @ApiProperty({ enum: EXPORT_FORMATS, example: 'xlsx' })
  @IsIn(EXPORT_FORMATS as unknown as string[])
  format!: ExportFormat;
}

export class CreateScheduleDto extends CreateExportDto {
  @ApiProperty({ enum: EXPORT_FREQUENCIES })
  @IsIn(EXPORT_FREQUENCIES as unknown as string[])
  frequency!: ExportFrequency;

  @ApiPropertyOptional({ description: 'Hour of day in UTC (0-23)', default: 6 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(23)
  hourUtc?: number;
}

export class UpdateScheduleDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional({ enum: EXPORT_FORMATS }) @IsOptional() @IsIn(EXPORT_FORMATS as unknown as string[]) format?: ExportFormat;
  @ApiPropertyOptional({ enum: EXPORT_FREQUENCIES }) @IsOptional() @IsIn(EXPORT_FREQUENCIES as unknown as string[]) frequency?: ExportFrequency;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(23) hourUtc?: number;
}

export class ExportAuditQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() userId?: string;
  @ApiPropertyOptional({ example: 'EXPORT_CREATED' }) @IsOptional() @IsString() @MaxLength(100) action?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
  @ApiPropertyOptional({ default: 50 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}
