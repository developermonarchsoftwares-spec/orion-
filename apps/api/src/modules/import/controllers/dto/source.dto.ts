import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { SOURCE_TRUST_STATUSES, SourceTrustStatus } from '../../provenance/provenance.util';

const SOURCE_TYPES = ['GOVERNMENT_REGISTRY', 'WEB_SCRAPING', 'MANUAL_IMPORT', 'API_INTEGRATION', 'USER_SUBMISSION', 'PARTNER_FEED'] as const;

export class RegisterSourceDto {
  @ApiProperty({ example: 'State registry CSV export (licensed)' })
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  name!: string;

  @ApiProperty({ enum: SOURCE_TYPES })
  @IsIn(SOURCE_TYPES as unknown as string[])
  type!: (typeof SOURCE_TYPES)[number];

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string;

  @ApiPropertyOptional({ example: 'CSV_UPLOAD', description: 'How the data is obtained, as stated by the administrator. Not verified by Orion.' })
  @IsOptional()
  @Matches(/^[A-Z][A-Z0-9_]{1,39}$/)
  collectionMethod?: string;

  @ApiPropertyOptional({ description: 'A reference to the source terms or licence, where one exists' }) @IsOptional() @IsString() @MaxLength(500) sourceReference?: string;

  @ApiPropertyOptional({ description: 'Permitted purposes and limits' }) @IsOptional() @IsString() @MaxLength(1000) usageRestrictions?: string;
}

export class SetSourceTrustDto {
  @ApiProperty({ enum: SOURCE_TRUST_STATUSES })
  @IsIn(SOURCE_TRUST_STATUSES as unknown as string[])
  status!: SourceTrustStatus;

  @ApiProperty({ description: 'Why (10 to 500 characters). Recorded in the audit trail.' })
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;

  @ApiPropertyOptional({ description: 'Required when restricting a source: what is permitted' }) @IsOptional() @IsString() @MaxLength(1000) usageRestrictions?: string;
}

export class ReleaseHeldDto {
  @ApiProperty() @IsString() @MinLength(10) @MaxLength(500) reason!: string;
}

export class PublishBatchDto {
  @ApiPropertyOptional({ description: 'Knowingly publish records whose source is unreviewed, unnamed or restricted. Recorded as an override in the audit trail. A revoked source is always refused.' })
  @IsOptional()
  @IsBoolean()
  allowUnreviewedSource?: boolean;
}
