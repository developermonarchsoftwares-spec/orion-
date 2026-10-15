import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDefined, IsOptional, IsString, MaxLength } from 'class-validator';

/** Body of the administrator pricing-setting update. `value` is validated per key by the service (ranges and shapes, SG-22). */
export class UpdatePricingSettingDto {
  @ApiProperty({ description: 'Setting key, e.g. DAILY_FREE_CREDITS' })
  @IsString()
  @MaxLength(64)
  key!: string;

  @ApiProperty({ description: 'New value; its shape depends on the key' })
  @IsDefined()
  value!: unknown;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
