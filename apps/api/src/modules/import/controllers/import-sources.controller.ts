import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { sql } from 'drizzle-orm';
import type { Request } from 'express';
import { Inject } from '@nestjs/common';
import { IJwtPayload, UserRole } from '@orion/shared';
import { CurrentUser, Roles } from '../../../auth/decorators';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { DRIZZLE_DATABASE } from '../../../database/database.constants';
import { DrizzleDb } from '../../../database/database.provider';
import { DEFAULT_FRESHNESS_DAYS } from '../provenance/provenance.util';
import { SourceTrustService } from '../services/source-trust.service';
import { RegisterSourceDto, ReleaseHeldDto, SetSourceTrustDto } from './dto/source.dto';

const actorOf = (user: IJwtPayload, req: Request) => ({ id: user.sub, ip: req.ip ?? null, userAgent: (req.headers['user-agent'] as string) ?? null });

/**
 * Source registry and trust decisions (Phase 15). Administrators only (ADMIN, SUPER_ADMIN). Every change is audited with who, what and why.
 * The register holds descriptions and restrictions that are internal: no customer-facing endpoint returns them.
 */
@ApiTags('Admin Ingestion & Data Quality')
@ApiBearerAuth()
@Controller('admin/import')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
export class ImportSourcesController {
  constructor(
    private readonly sources: SourceTrustService,
    @Inject(DRIZZLE_DATABASE) private readonly db: DrizzleDb,
  ) {}

  @Get('sources')
  @ApiOperation({ summary: 'Registered data sources with their trust status' })
  list() {
    return this.sources.list();
  }

  @Post('sources')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Register a data source. It starts UNREVIEWED: registering is not approving.' })
  register(@CurrentUser() user: IJwtPayload, @Body() dto: RegisterSourceDto, @Req() req: Request) {
    return this.sources.register(dto, actorOf(user, req));
  }

  @Patch('sources/:id/trust')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Approve, restrict, revoke or reset a source (reason required; revoking holds back what it published)' })
  setTrust(@CurrentUser() user: IJwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetSourceTrustDto, @Req() req: Request) {
    return this.sources.setTrust(id, dto.status, dto.reason, dto.usageRestrictions, actorOf(user, req));
  }

  @Post('sources/:id/release-held')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Put back the businesses a revocation held back (the source must be approved or restricted again)' })
  releaseHeld(@CurrentUser() user: IJwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReleaseHeldDto, @Req() req: Request) {
    return this.sources.releaseHeld(id, dto.reason, actorOf(user, req));
  }

  @Get('sources/:id/impact')
  @ApiOperation({ summary: 'How many businesses and batches come from this source' })
  impact(@Param('id', ParseUUIDPipe) id: string) {
    return this.sources.impact(id);
  }

  /**
   * Data-quality overview for reviewers: counts only, no record content. Cheap indexed counts, except the two metadata counts, which scan
   * the businesses table once (an on-demand administrator report, never part of a customer request).
   */
  @Get('quality')
  @ApiOperation({ summary: 'Data-quality overview: records awaiting action, sources by trust, businesses needing review or with stale checks' })
  async quality() {
    const rows = async <T>(q: ReturnType<typeof sql>) => (await this.db.execute(q)).rows as unknown as T[];
    const [records, queue, sources, businesses, flags] = await Promise.all([
      rows<{ status: string; n: string }>(sql`SELECT status::text AS status, count(*)::text AS n FROM import_records GROUP BY status`),
      rows<{ status: string; n: string }>(sql`SELECT status, count(*)::text AS n FROM publish_queue GROUP BY status`),
      rows<{ trust_status: string; n: string }>(sql`SELECT trust_status, count(*)::text AS n FROM data_sources GROUP BY trust_status`),
      rows<{ status: string; n: string }>(sql`SELECT status::text AS status, count(*)::text AS n FROM businesses GROUP BY status`),
      rows<{ needs_review: string; stale: string; from_unapproved: string; no_source: string }>(sql`
        SELECT
          count(*) FILTER (WHERE b.metadata->'quality'->>'needsReview' = 'true')::text AS needs_review,
          count(*) FILTER (WHERE b.metadata->'verification'->>'checkedAt' IS NOT NULL AND (b.metadata->'verification'->>'checkedAt')::timestamptz < now() - (${DEFAULT_FRESHNESS_DAYS} || ' days')::interval)::text AS stale,
          count(*) FILTER (WHERE b.source_id IS NOT NULL AND s.trust_status <> 'APPROVED')::text AS from_unapproved,
          count(*) FILTER (WHERE b.source_id IS NULL AND b.status = 'PUBLISHED')::text AS no_source
        FROM businesses b LEFT JOIN data_sources s ON s.id = b.source_id`),
    ]);
    const toMap = (r: Array<Record<string, string>>, k: string) => Object.fromEntries(r.map((x) => [x[k], Number(x.n)]));
    const f = flags[0] ?? { needs_review: '0', stale: '0', from_unapproved: '0', no_source: '0' };
    return {
      importRecordsByStatus: toMap(records, 'status'),
      publishQueueByStatus: toMap(queue, 'status'),
      sourcesByTrust: toMap(sources, 'trust_status'),
      businessesByStatus: toMap(businesses, 'status'),
      businessesNeedingReview: Number(f.needs_review),
      businessesWithStaleChecks: Number(f.stale),
      businessesFromUnapprovedSources: Number(f.from_unapproved),
      publishedBusinessesWithUnknownProvenance: Number(f.no_source),
      rules: 'See docs/DATA_PROVENANCE.md section 7 for which state blocks publication, triggers review or is disclosed.',
    };
  }
}
