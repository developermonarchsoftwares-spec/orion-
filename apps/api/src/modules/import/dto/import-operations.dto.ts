import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsISO8601, IsNumber, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export const OPS_BATCH_STATUSES = ['PENDING', 'PARSING', 'PROCESSING', 'ENRICHING', 'COMPLETED', 'FAILED', 'CANCELLED', 'ALL'] as const;
export const OPS_RECORD_STATUSES = ['PENDING', 'NORMALIZED', 'VALIDATED', 'FLAGGED_DUPLICATE', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED', 'MERGED', 'PUBLISHED', 'FAILED', 'ALL'] as const;

/** Deterministic list filters: newest first, ties broken by id. */
export class OpsBatchesQueryDto {
  @ApiPropertyOptional({ enum: OPS_BATCH_STATUSES, default: 'ALL' })
  @IsOptional() @IsIn(OPS_BATCH_STATUSES as unknown as string[]) status?: (typeof OPS_BATCH_STATUSES)[number];
  @ApiPropertyOptional({ description: 'Created at or after (ISO 8601)' }) @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional({ description: 'Created at or before (ISO 8601)' }) @IsOptional() @IsISO8601() to?: string;
  @ApiPropertyOptional({ description: 'File name contains' }) @IsOptional() @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() sourceId?: string;
  @ApiPropertyOptional({ description: 'Only batches with problems (failed rows, rejected / quarantined / errored people)' })
  @IsOptional() @IsIn(['true', 'false']) hasIssues?: 'true' | 'false';
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsNumber() @Min(1) page?: number = 1;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsNumber() @Min(1) @Max(100) limit?: number = 20;
}

export class OpsRecordsQueryDto {
  @ApiPropertyOptional({ enum: OPS_RECORD_STATUSES, default: 'ALL' })
  @IsOptional() @IsIn(OPS_RECORD_STATUSES as unknown as string[]) status?: (typeof OPS_RECORD_STATUSES)[number];
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsNumber() @Min(1) page?: number = 1;
  @ApiPropertyOptional({ default: 50 }) @IsOptional() @Type(() => Number) @IsNumber() @Min(1) @Max(200) limit?: number = 50;
}

export class CorrectRecordDto {
  @ApiPropertyOptional({ description: 'Fields to set on the row, by the column names shown in the failed-rows CSV; an empty value removes the field', example: { email: 'sales@acme.in', pincode: '400001' } })
  @IsObject()
  fields!: Record<string, unknown>;
}
