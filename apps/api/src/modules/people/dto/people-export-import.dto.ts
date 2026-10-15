import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { MAX_IMPORT_CONTENT_CHARS } from '../ingestion/people-export-import.service';

/** Body of POST /admin/people/import: the People Pipeline export file as text. */
export class PeopleExportImportDto {
  @ApiProperty({ enum: ['csv', 'json'], description: 'Format of `content`' })
  @IsIn(['csv', 'json'])
  format!: 'csv' | 'json';

  @ApiProperty({ description: 'The export file, as text (CSV, or the JSON envelope)' })
  @IsString()
  @MaxLength(MAX_IMPORT_CONTENT_CHARS)
  content!: string;

  @ApiPropertyOptional({ description: 'Parse, validate and resolve companies without writing anything', default: false })
  @IsOptional()
  @Transform(({ obj }) => obj.dryRun) // no implicit string -> boolean coercion: only a real boolean is accepted
  @IsBoolean()
  dryRun?: boolean;
}

/** Query of GET /admin/people/import (import history). */
export class PeopleImportHistoryQueryDto {
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsNumber() @Min(1) page?: number = 1;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsNumber() @Min(1) @Max(100) limit?: number = 20;
}
