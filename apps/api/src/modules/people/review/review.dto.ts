import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const toBool = ({ value }: { value: unknown }) =>
  value === undefined || value === null || value === '' ? undefined : value === 'true' || value === true;

export const REVIEW_STATUS_FILTERS = ['PENDING', 'APPROVED', 'REJECTED', 'QUARANTINED', 'ALL'] as const;
export const QUEUE_SORTS = ['created_desc', 'created_asc', 'updated_desc', 'confidence_desc', 'confidence_asc'] as const;

export class ReviewQueueQueryDto {
  @ApiPropertyOptional({ enum: REVIEW_STATUS_FILTERS, default: 'PENDING' })
  @IsOptional()
  @IsIn(REVIEW_STATUS_FILTERS as unknown as string[])
  status?: (typeof REVIEW_STATUS_FILTERS)[number];

  @ApiPropertyOptional({ description: 'Exact company id' })
  @IsOptional()
  @IsUUID()
  businessId?: string;

  @ApiPropertyOptional({ description: 'Company name contains' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  company?: string;

  @ApiPropertyOptional({ description: 'Person name or job title contains' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional({ description: 'Decision-maker type(s), comma separated. Use NONE for unclassified roles' })
  @IsOptional()
  @IsString()
  decisionMakerType?: string;

  @ApiPropertyOptional({ description: 'Stored verification status(es), comma separated' })
  @IsOptional()
  @IsString()
  verification?: string;

  @ApiPropertyOptional({ description: 'Evidence source type(s), comma separated (roles having evidence from any of them)' })
  @IsOptional()
  @IsString()
  source?: string;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) minConfidence?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) maxConfidence?: number;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() createdFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() createdTo?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() updatedFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() updatedTo?: string;

  @ApiPropertyOptional({ description: 'Only roles that have (true) / lack (false) any evidence' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  hasEvidence?: boolean;

  @ApiPropertyOptional({ enum: QUEUE_SORTS, default: 'created_desc' })
  @IsOptional()
  @IsIn(QUEUE_SORTS as unknown as string[])
  sort?: (typeof QUEUE_SORTS)[number];

  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsNumber() @Min(1) page?: number = 1;
  @ApiPropertyOptional({ default: 25 }) @IsOptional() @Type(() => Number) @IsNumber() @Min(1) @Max(100) limit?: number = 25;
}

export class ReasonDto {
  @ApiPropertyOptional({ description: 'Why (audited). Required for reject, quarantine, suppress and unpublish.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

export class ApproveDto extends ReasonDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'Contact ids of THIS person to publish together with the role. Contacts are never published implicitly.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  publishContactIds?: string[];
}

export class EvidenceSourceDto {
  @ApiPropertyOptional({ description: 'GOVERNMENT_REGISTRY | WEB_SCRAPING | MANUAL_IMPORT | API_INTEGRATION | USER_SUBMISSION | PARTNER_FEED' })
  @IsString()
  @IsNotEmpty()
  type!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) reference?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) url?: string;
}

export class ContactEditDto {
  @ApiPropertyOptional({ description: 'Existing contact to change. Omit to add a new one.' })
  @IsOptional()
  @IsUUID()
  contactId?: string;

  @IsIn(['WORK_EMAIL', 'PHONE', 'MOBILE']) type!: 'WORK_EMAIL' | 'PHONE' | 'MOBILE';
  @IsString() @IsNotEmpty() @MaxLength(255) value!: string;

  @ApiPropertyOptional({ description: 'What supports this value. Required: a reviewer may not enter unsourced contact data.' })
  @IsDefined()
  @ValidateNested()
  @Type(() => EvidenceSourceDto)
  source!: EvidenceSourceDto;
}

export class AddEvidenceDto {
  @IsString() @IsNotEmpty() sourceType!: string;
  @IsString() @IsNotEmpty() @MaxLength(40) evidenceType!: string;
  @IsOptional() @IsString() @MaxLength(255) sourceReference?: string;
  @IsOptional() @IsString() @MaxLength(1000) sourceUrl?: string;
  @IsOptional() @IsISO8601() observedAt?: string;
}

export class RoleEditDto extends ReasonDto {
  @IsOptional() @IsString() @MaxLength(200) fullName?: string;
  @IsOptional() @IsString() @MaxLength(200) jobTitle?: string;

  @ApiPropertyOptional({ description: 'Overrides the automatic classification (validated against the taxonomy)' })
  @IsOptional() @IsString() department?: string;
  @IsOptional() @IsString() seniorityLevel?: string;
  @ApiPropertyOptional({ nullable: true, description: 'null clears the decision-maker type' })
  @IsOptional() decisionMakerType?: string | null;

  @IsOptional() @IsBoolean() isCurrent?: boolean;
  @IsOptional() @IsString() startDate?: string;
  @IsOptional() @IsString() endDate?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => ContactEditDto) contacts?: ContactEditDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => AddEvidenceDto) addEvidence?: AddEvidenceDto[];
}

export class EditAndApproveDto extends RoleEditDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID('all', { each: true }) publishContactIds?: string[];
}

export class QuarantineQueryDto {
  @ApiPropertyOptional({ enum: ['PENDING', 'RESOLVED', 'DISCARDED', 'ALL'], default: 'PENDING' })
  @IsOptional() @IsIn(['PENDING', 'RESOLVED', 'DISCARDED', 'ALL']) status?: 'PENDING' | 'RESOLVED' | 'DISCARDED' | 'ALL';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) batchRef?: string;
  @ApiPropertyOptional({ description: 'Reason code, e.g. AMBIGUOUS_IDENTITY' }) @IsOptional() @IsString() code?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() createdFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() createdTo?: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsNumber() @Min(1) page?: number = 1;
  @ApiPropertyOptional({ default: 25 }) @IsOptional() @Type(() => Number) @IsNumber() @Min(1) @Max(100) limit?: number = 25;
}

/** Fields a reviewer may correct on a quarantined record before retrying. Provenance and verification are deliberately excluded. */
export class RetryPatchDto extends ReasonDto {
  @ApiPropertyOptional({
    description:
      'personName, jobTitle, email, phone, mobile, linkedinUrl, businessId, businessSlug, businessIdentifier{type,value}, isCurrent, startDate, endDate, location, city, state, country',
  })
  @IsOptional()
  @IsObject()
  patch?: Record<string, unknown>;
}

export const TRIAGE_CATEGORIES = ['QUARANTINE', 'CONFLICT', 'VERIFICATION', 'CLASSIFICATION', 'IDENTITY', 'CONTACT', 'SUPPRESSION'] as const;
export const TRIAGE_PRIORITIES = ['CRITICAL', 'HIGH', 'NORMAL', 'LOW'] as const;

/** Read-only triage filters (Phase 6.10). Page / limit pagination like the other review lists. */
export class TriageQueryDto {
  @ApiPropertyOptional({ description: `Category or comma separated categories: ${TRIAGE_CATEGORIES.join(', ')}` })
  @IsOptional() @IsString() @MaxLength(200) category?: string;
  @ApiPropertyOptional({ description: `Priority or comma separated priorities: ${TRIAGE_PRIORITIES.join(', ')}` })
  @IsOptional() @IsString() @MaxLength(100) priority?: string;
  @ApiPropertyOptional({ description: 'Status of the underlying record (PENDING, OPEN, APPROVED, ...)' })
  @IsOptional() @IsString() @MaxLength(30) status?: string;
  @ApiPropertyOptional({ description: 'Person or company name contains' })
  @IsOptional() @IsString() @MaxLength(200) q?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() businessId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() personId?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() detectedFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() detectedTo?: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsNumber() @Min(1) page?: number = 1;
  @ApiPropertyOptional({ default: 25 }) @IsOptional() @Type(() => Number) @IsNumber() @Min(1) @Max(100) limit?: number = 25;
}

export class QuarantineSuppressDto extends ReasonDto {
  @ApiPropertyOptional({ description: 'Existing person to suppress. Required when the record cannot be resolved to one.' })
  @IsOptional()
  @IsUUID()
  personId?: string;
}
