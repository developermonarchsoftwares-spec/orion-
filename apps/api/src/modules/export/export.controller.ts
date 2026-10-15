import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { IJwtPayload, UserRole } from '@orion/shared';
import { CurrentUser, Roles } from '../../auth/decorators';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { CreateExportDto, CreateScheduleDto, ExportAuditQueryDto, UpdateScheduleDto } from './dto/export.dto';
import { applyDownloadHeaders } from '../../common/http/download-headers';
import { REQUEST_ID_HEADER } from '../../common/constants';
import { ExportService, IRequestContext } from './export.service';

const ctxOf = (req: Request): IRequestContext => ({
  ip: req.ip ?? null,
  userAgent: (req.headers['user-agent'] as string) ?? null,
  requestId: (req.headers[REQUEST_ID_HEADER] as string) ?? null,
});

@ApiTags('Exports')
@ApiBearerAuth()
@Controller('exports')
@UseGuards(JwtAuthGuard)
export class ExportController {
  constructor(private readonly exports: ExportService) {}

  @Get('datasets')
  @ApiOperation({ summary: 'What can be exported, in which formats' })
  datasets() {
    return this.exports.listDatasets();
  }

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Export a dataset now, as CSV or XLSX (the file is the response)' })
  async create(@CurrentUser() user: IJwtPayload, @Body() dto: CreateExportDto, @Req() req: Request, @Res() res: Response) {
    const r = await this.exports.createExport(user.sub, dto.dataset, dto.format, { source: 'ON_DEMAND', ctx: ctxOf(req) });
    applyDownloadHeaders(res, r.file.contentType, r.file.fileName);
    res.setHeader('X-Export-Id', r.job.id);
    res.setHeader('X-Export-Row-Count', String(r.rowCount));
    res.setHeader('X-Export-Truncated', String(r.truncated));
    res.send(r.file.buffer);
  }

  @Get('history')
  @ApiOperation({ summary: 'Your exports: when, what, how many rows, and whether the file can still be downloaded' })
  history(@CurrentUser() user: IJwtPayload, @Query('limit') limit = '50') {
    return this.exports.listJobs(user.sub, Number.parseInt(String(limit), 10));
  }

  // ---- schedules (declared before ':id/download' so 'schedules' is never read as an id) ----

  @Get('schedules')
  @ApiOperation({ summary: 'Your scheduled exports' })
  schedules(@CurrentUser() user: IJwtPayload) {
    return this.exports.listSchedules(user.sub);
  }

  @Post('schedules')
  @ApiOperation({ summary: 'Schedule a recurring export (daily, weekly or monthly, at an hour in UTC)' })
  createSchedule(@CurrentUser() user: IJwtPayload, @Body() dto: CreateScheduleDto, @Req() req: Request) {
    return this.exports.createSchedule(user.sub, dto, ctxOf(req));
  }

  @Patch('schedules/:id')
  @ApiOperation({ summary: 'Change a schedule, or switch it on or off' })
  updateSchedule(@CurrentUser() user: IJwtPayload, @Param('id') id: string, @Body() dto: UpdateScheduleDto, @Req() req: Request) {
    return this.exports.updateSchedule(user.sub, id, dto, ctxOf(req));
  }

  @Delete('schedules/:id')
  @ApiOperation({ summary: 'Delete a schedule' })
  deleteSchedule(@CurrentUser() user: IJwtPayload, @Param('id') id: string, @Req() req: Request) {
    return this.exports.deleteSchedule(user.sub, id, ctxOf(req));
  }

  // ---- audit (administrators) ----

  @UseGuards(RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Get('admin/audit')
  @ApiOperation({ summary: 'Admin: export audit trail (who exported what, when, from where)' })
  audit(@Query() q: ExportAuditQueryDto) {
    return this.exports.auditTrail(q);
  }

  @Get(':id/download')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'Download the file of a scheduled export (owner only, kept for 7 days)' })
  async download(@CurrentUser() user: IJwtPayload, @Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const f = await this.exports.download(user.sub, id, ctxOf(req));
    applyDownloadHeaders(res, f.contentType, f.fileName);
    res.send(f.buffer);
  }
}
