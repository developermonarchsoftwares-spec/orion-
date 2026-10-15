import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { INTEGRATION_TYPES, IntegrationType } from '../integration.constants';

export class CreateIntegrationDto {
  @ApiProperty({ enum: INTEGRATION_TYPES })
  @IsIn(INTEGRATION_TYPES as unknown as string[])
  type!: IntegrationType;

  @ApiProperty({ example: 'Sales team webhook' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ description: 'WEBHOOK: https endpoint that receives the events', example: 'https://example.com/orion-hook' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  targetUrl?: string;

  @ApiPropertyOptional({ description: 'WEBHOOK: events to receive (GET /integrations/events)', example: ['lead.unlocked'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  events?: string[];

  @ApiPropertyOptional({ description: 'HUBSPOT: private-app access token (stored encrypted, never returned)' })
  @IsOptional()
  @IsString()
  @MinLength(20)
  @MaxLength(500)
  credential?: string;
}

export class UpdateIntegrationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) targetUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) events?: string[];
  @ApiPropertyOptional({ enum: ['ACTIVE', 'PAUSED'], description: 'ACTIVE also switches a disabled integration back on (and clears its failure count)' })
  @IsOptional()
  @IsIn(['ACTIVE', 'PAUSED'])
  status?: 'ACTIVE' | 'PAUSED';
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(20) @MaxLength(500) credential?: string;
}

export class DeliveriesQueryDto {
  @ApiPropertyOptional({ enum: ['PENDING', 'FAILED', 'SUCCEEDED', 'DEAD'] }) @IsOptional() @IsIn(['PENDING', 'FAILED', 'SUCCEEDED', 'DEAD']) status?: string;
  @ApiPropertyOptional({ default: 25 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}

export class SyncDto {
  @ApiPropertyOptional({ description: 'Most records to push in this call (max 200)', default: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class ValidateDto {
  @ApiPropertyOptional({ description: 'CRM: also ask the CRM whether recorded records still exist and match (up to remoteLimit)', default: false })
  @IsOptional()
  @IsBoolean()
  remote?: boolean;

  @ApiPropertyOptional({ default: 50 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) remoteLimit?: number;
  @ApiPropertyOptional({ description: 'WEBHOOK: how many days of deliveries to reconcile (max 14)', default: 7 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(14) days?: number;
}

export class AckCallbackDto {
  @ApiProperty({ description: 'The X-Orion-Delivery id (or deliveryId in the payload) of the event being acknowledged' })
  @IsUUID()
  deliveryId!: string;

  @ApiProperty({ enum: ['PROCESSED', 'REJECTED'] })
  @IsIn(['PROCESSED', 'REJECTED'])
  status!: 'PROCESSED' | 'REJECTED';

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) message?: string;
}
