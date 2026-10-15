import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsISO8601, IsOptional, IsString, IsUrl, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { CLAIM_TYPES } from '../policies/claim-verification.policy';

const SOURCE_TYPES = ['GOVERNMENT_REGISTRY', 'WEB_SCRAPING', 'MANUAL_IMPORT', 'API_INTEGRATION', 'USER_SUBMISSION', 'PARTNER_FEED'];
const ALL_EVIDENCE_TYPES = ['REGISTRY_FILING', 'DOCUMENT', 'DIRECT_CONFIRMATION', 'COMPANY_WEBSITE', 'PROFESSIONAL_PROFILE', 'EMAIL_DELIVERY_CHECK'];

export class NewEvidenceDto {
  @ApiProperty({ enum: SOURCE_TYPES })
  @IsIn(SOURCE_TYPES)
  sourceType!: string;

  @ApiProperty({ enum: ALL_EVIDENCE_TYPES, description: 'What the evidence is. Which types can support which claim is decided server-side.' })
  @IsIn(ALL_EVIDENCE_TYPES)
  evidenceType!: string;

  @ApiPropertyOptional({ description: 'Where the reviewer saw it (page, filing number, call log). Required unless sourceUrl is given.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  sourceReference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  @MaxLength(2000)
  sourceUrl?: string;

  @ApiPropertyOptional({ description: 'When the reviewer observed it (defaults to now; not in the future).' })
  @IsOptional()
  @IsISO8601()
  observedAt?: string;
}

class ClaimTargetDto {
  @ApiProperty({ enum: CLAIM_TYPES })
  @IsIn([...CLAIM_TYPES])
  claim!: string;

  @ApiPropertyOptional({ description: 'Required for EMAIL / PHONE: the contact of THIS person.' })
  @IsOptional()
  @IsUUID('all')
  contactId?: string;
}

export class VerifyClaimDto extends ClaimTargetDto {
  @ApiPropertyOptional({ description: 'An existing evidence row of the right scope. Provide this OR evidence.' })
  @IsOptional()
  @IsUUID('all')
  evidenceId?: string;

  @ApiPropertyOptional({ type: NewEvidenceDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => NewEvidenceDto)
  evidence?: NewEvidenceDto;

  @ApiProperty({ description: 'Why this evidence supports the claim (audited).' })
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  note!: string;
}

export class DisputeClaimDto extends ClaimTargetDto {
  @ApiProperty({ description: 'Why the claim is disputed (audited).' })
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  note!: string;
}
