import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IJwtPayload, UserRole } from '@orion/shared';
import { CurrentUser, Roles } from '../../../auth/decorators';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { PeopleExportImportDto, PeopleImportHistoryQueryDto } from '../dto/people-export-import.dto';
import { IPeopleImportAccepted, IPeopleImportJobView, PeopleImportJobService } from './people-import-job.service';

/**
 * Admin-only People import of the People Pipeline's published-people export, run as a background job on the existing queue.
 * People only: it never creates a company, and everything it accepts is DRAFT / PENDING / unpublished / unverified
 * (see PEOPLE_EXPORT_IMPORT.md).
 */
@ApiTags('Admin People Import')
@ApiBearerAuth()
@Controller('admin/people/import')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PeopleExportImportController {
  constructor(private readonly jobs: PeopleImportJobService) {}

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Validate a People Pipeline export and queue its import (CSV or JSON); `dryRun` validates and resolves without writing People data' })
  enqueue(@Body() body: PeopleExportImportDto, @CurrentUser() user: IJwtPayload): Promise<IPeopleImportAccepted> {
    return this.jobs.enqueue({ format: body.format, content: body.content, dryRun: body.dryRun, requestedBy: user?.sub });
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Get()
  @ApiOperation({ summary: 'Import history: People import jobs, newest first (counts and statuses only)' })
  history(@Query() query: PeopleImportHistoryQueryDto) {
    return this.jobs.listJobs(query.page ?? 1, query.limit ?? 20);
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Get(':jobId')
  @ApiOperation({ summary: 'Status and counts of a queued People import (no People data)' })
  status(@Param('jobId', new ParseUUIDPipe()) jobId: string): Promise<IPeopleImportJobView> {
    return this.jobs.getJob(jobId);
  }
}
