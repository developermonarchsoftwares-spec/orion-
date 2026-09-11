import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsOptional, IsString } from 'class-validator';

export class DateRangeDto {
  @ApiPropertyOptional({ description: 'Start date in ISO-8601 format' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startDate?: Date;

  @ApiPropertyOptional({ description: 'End date in ISO-8601 format' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  endDate?: Date;
}

