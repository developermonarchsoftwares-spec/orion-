import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

/** Upper bound for a single manual adjustment, so a typo or a malformed request cannot move a wallet by an absurd amount. */
export const MAX_ADMIN_CREDIT_DELTA = 1_000_000;

/**
 * Body of POST credit/admin/adjust. It used to be an inline object type, which the global ValidationPipe cannot validate: a string
 * delta was concatenated into the wallet arithmetic and a non-numeric or non-UUID value reached the database layer.
 */
export class AdminAdjustCreditsDto {
  @ApiProperty({ description: 'User whose wallet is adjusted' })
  @IsUUID()
  userId!: string;

  @ApiPropertyOptional({ description: 'Change to the daily balance (whole credits, may be negative)', default: 0 })
  @IsOptional()
  @IsInt()
  @Min(-MAX_ADMIN_CREDIT_DELTA)
  @Max(MAX_ADMIN_CREDIT_DELTA)
  dailyDelta?: number;

  @ApiPropertyOptional({ description: 'Change to the purchased balance (whole credits, may be negative)', default: 0 })
  @IsOptional()
  @IsInt()
  @Min(-MAX_ADMIN_CREDIT_DELTA)
  @Max(MAX_ADMIN_CREDIT_DELTA)
  purchasedDelta?: number;

  @ApiPropertyOptional({ description: 'Audit reason recorded on the ledger entry' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}
