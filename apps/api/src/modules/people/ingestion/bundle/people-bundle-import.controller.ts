import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IJwtPayload, UserRole } from '@orion/shared';
import { CurrentUser, Roles } from '../../../../auth/decorators';
import { JwtAuthGuard } from '../../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../../auth/guards/roles.guard';
import { PeopleBundleImportDto } from '../../dto/people-bundle-import.dto';
import { IBundleAccepted, IBundleSummary, IBundleView, PeopleBundleImportService } from './people-bundle-import.service';

/**
 * Admin-only import of a People Pipeline split-export ZIP (Phase 9D). Orchestration only: every part becomes an ordinary People
 * import job (see PEOPLE_EXPORT_IMPORT.md), so company matching, deduplication, quarantine and the DRAFT / PENDING / unpublished
 * defaults are exactly those of a single-file import.
 */
@ApiTags('Admin People Import')
@ApiBearerAuth()
@Controller('admin/people/import/bundle')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PeopleBundleImportController {
  constructor(private readonly bundles: PeopleBundleImportService) {}

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validate a Pipeline bundle (ZIP, manifest, every part) without importing anything' })
  validate(@Body() body: PeopleBundleImportDto): IBundleSummary {
    return this.bundles.summary(this.bundles.validate(body.content));
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Validate a Pipeline bundle and queue every part, in manifest order, as a People import job' })
  enqueue(@Body() body: PeopleBundleImportDto, @CurrentUser() user: IJwtPayload): Promise<IBundleAccepted> {
    return this.bundles.enqueue({ content: body.content, dryRun: body.dryRun, requestedBy: user?.sub });
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Get(':bundleImportId')
  @ApiOperation({ summary: 'Aggregate status, per-part results and manifest reconciliation of a bundle import (counts only)' })
  status(@Param('bundleImportId', new ParseUUIDPipe()) id: string): Promise<IBundleView> {
    return this.bundles.getBundle(id);
  }
}
