import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';

export class IpRuleDto {
  @ApiProperty({ example: '203.0.113.0/24', description: 'A single address or a CIDR range (IPv4 or IPv6)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  cidr!: string;

  @ApiProperty({ enum: ['DENY', 'ALLOW'] })
  @IsIn(['DENY', 'ALLOW'])
  action!: 'DENY' | 'ALLOW';

  @ApiPropertyOptional({ enum: ['GLOBAL', 'ADMIN'], default: 'GLOBAL', description: 'GLOBAL DENY blocks the address; GLOBAL ALLOW trusts it (no rate limits, no automatic blocks); ADMIN ALLOW restricts the admin routes to these ranges' })
  @IsOptional()
  @IsIn(['GLOBAL', 'ADMIN'])
  scope?: 'GLOBAL' | 'ADMIN';

  @ApiProperty()
  @IsString()
  @MinLength(5)
  @MaxLength(200)
  reason!: string;

  @ApiPropertyOptional({ description: 'The rule expires after this many hours (omit for no expiry)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8760)
  expiresInHours?: number;
}

export class BlockDto {
  @ApiProperty({ enum: ['IP', 'USER'] })
  @IsIn(['IP', 'USER'])
  subjectType!: 'IP' | 'USER';

  @ApiProperty({ description: 'An IP address, or a user id' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  subject!: string;

  @ApiProperty()
  @IsString()
  @MinLength(5)
  @MaxLength(200)
  reason!: string;

  @ApiProperty({ example: 60, description: 'How long the block lasts, in minutes (at most 30 days)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(43200)
  minutes!: number;
}

export class UserLimitDto {
  @ApiPropertyOptional({ nullable: true, description: 'Requests per minute (null keeps the plan default)' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  perMinute?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Requests per day (null keeps the plan default)' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  perDay?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}
