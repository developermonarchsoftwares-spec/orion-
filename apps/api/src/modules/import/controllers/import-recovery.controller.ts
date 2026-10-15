import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { IJwtPayload, UserRole } from '@orion/shared';
import { CurrentUser, Roles } from '../../../auth/decorators';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { CorrectRecordDto } from '../dto/import-operations.dto';
import { IActor, ImportRecoveryService } from '../services/import-recovery.service';

/**
 * Validation report and recovery of failed rows. A separate controller from the read-only operations view (same route prefix, same
 * audience: SUPER_ADMIN and ADMIN only) because these actions write.
 */
@ApiTags('Admin Ingestion & Data Quality')
@ApiBearerAuth()
@Controller('admin/import/operations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ImportRecoveryController {
  constructor(private readonly recovery: ImportRecoveryService) {}

  private actor(user: IJwtPayload, req: Request): IActor {
    return { userId: user.sub, ip: req.ip ?? null, userAgent: (req.headers['user-agent'] as string) ?? null };
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Get('batches/:batchId/report')
  @ApiOperation({ summary: 'Validation report: row statuses, failures by rule and field, and every failed row with its reasons' })
  report(@Param('batchId', ParseUUIDPipe) batchId: string) {
    return this.recovery.report(batchId);
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Get('batches/:batchId/report.csv')
  @ApiOperation({ summary: 'The validation report as a CSV (one line per issue)' })
  async reportCsv(@CurrentUser() user: IJwtPayload, @Param('batchId', ParseUUIDPipe) batchId: string, @Req() req: Request, @Res() res: Response) {
    const r = await this.recovery.reportCsv(batchId, this.actor(user, req));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${r.filename}"`);
    res.send(r.csv);
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Get('batches/:batchId/failed.csv')
  @ApiOperation({ summary: 'Failed rows as a CSV with the reasons in `_errors`: correct them, and upload again (the `_` columns are ignored)' })
  async failedCsv(@CurrentUser() user: IJwtPayload, @Param('batchId', ParseUUIDPipe) batchId: string, @Req() req: Request, @Res() res: Response) {
    const r = await this.recovery.failedRowsCsv(batchId, this.actor(user, req));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${r.filename}"`);
    res.setHeader('X-Export-Row-Count', String(r.rowCount));
    res.send(r.csv);
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Post('batches/:batchId/retry-failed')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run every failed row of the batch through the pipeline again (up to 1000 per call)' })
  retryFailed(@CurrentUser() user: IJwtPayload, @Param('batchId', ParseUUIDPipe) batchId: string, @Req() req: Request) {
    return this.recovery.retryFailed(batchId, this.actor(user, req));
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Patch('records/:recordId')
  @ApiOperation({ summary: 'Correct fields of one failed row and re-run it (an empty value removes the field)' })
  correct(@CurrentUser() user: IJwtPayload, @Param('recordId', ParseUUIDPipe) recordId: string, @Body() dto: CorrectRecordDto, @Req() req: Request) {
    return this.recovery.correctRecord(recordId, dto.fields, this.actor(user, req));
  }
}
