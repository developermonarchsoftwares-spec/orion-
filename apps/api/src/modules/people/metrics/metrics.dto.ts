import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsISO8601, IsNumber, IsOptional, Max, Min } from 'class-validator';

/** Inclusive date range applied to the creation time of the measured events / records. Omitted = all time. */
export class MetricsRangeDto {
  @ApiPropertyOptional({ description: 'From (inclusive, ISO 8601)' }) @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional({ description: 'To (inclusive, ISO 8601)' }) @IsOptional() @IsISO8601() to?: string;
}

export class ProblemBatchesQueryDto extends MetricsRangeDto {
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsNumber() @Min(1) page?: number = 1;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsNumber() @Min(1) @Max(100) limit?: number = 20;
}
