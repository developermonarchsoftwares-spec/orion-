import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Res,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { PublishBatchDto } from './dto/source.dto';
import { AdminImportService } from '../services/admin-import.service';
import { parseCsv } from '../../../common/utils/csv-parse.util';
import { UPLOAD_LIMITS } from '../services/upload-validation';
import { BusinessException } from '../../../common/errors/business.exception';
import { CurrentUser, Public, Roles } from '../../../auth/decorators';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { IJwtPayload, UserRole } from '@orion/shared';
import { boundedWindow } from '../../../common/utils/pagination.util';
import { Throttle } from '@nestjs/throttler';

/** Reads an uploaded CSV file (as text). Structural problems become a report; an unusable file is refused with that report. */
function readCsvUpload(csv: unknown) {
  if (typeof csv !== 'string') throw new BusinessException('Send the file content as the `csv` text field', 'INVALID_CSV', HttpStatus.BAD_REQUEST);
  const parsed = parseCsv(csv, { maxRows: UPLOAD_LIMITS.MAX_ROWS, maxColumns: UPLOAD_LIMITS.MAX_COLUMNS_PER_ROW });
  if (parsed.issues.some((i) => i.fatal)) {
    throw new BusinessException('The CSV file could not be read', 'INVALID_CSV', HttpStatus.BAD_REQUEST, { issues: parsed.issues });
  }
  // columns starting with "_" (such as `_errors` / `_row_number` from the failed-rows download) are bookkeeping, not data
  const rows = parsed.rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('_'))));
  const headers = parsed.headers.filter((h) => h && !h.startsWith('_'));
  return { rows, report: { headers, delimiter: parsed.delimiter, rowCount: parsed.rowCount, issues: parsed.issues } };
}

@ApiTags('Admin Ingestion & Data Quality')
@Controller('admin/import')
export class AdminImportController {
  constructor(private readonly adminImportService: AdminImportService) {}

  @Public()
  @Get('template')
  @ApiOperation({ summary: 'Download canonical CSV import template for real Indian businesses' })
  async downloadTemplate(@Res() res: Response) {
    const csv = this.adminImportService.getCanonicalTemplateCsv();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="orion_canonical_business_import_template.csv"');
    res.send(csv);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Preview import records, map headers, and run duplicate & validation checks' })
  async previewRows(
    @Body() body: { rows: Array<Record<string, unknown>>; mapping?: Record<string, string> },
  ) {
    return this.adminImportService.previewRows(body.rows, body.mapping);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('submit')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Submit verified import batch and execute ingestion pipeline' })
  async submitBatch(
    @CurrentUser() user: IJwtPayload,
    @Body()
    body: {
      filename: string;
      rows: Array<Record<string, unknown>>;
      mapping?: Record<string, string>;
      autoPublish?: boolean;
      sourceId?: string;
    },
  ) {
    return this.adminImportService.submitBatch({
      filename: body.filename || 'import_batch.csv',
      rows: body.rows,
      createdById: user.sub,
      mapping: body.mapping,
      // automatic publication is opt-in and still needs an approved source; the default is that records wait for an administrator
      autoPublish: body.autoPublish === true,
      sourceId: body.sourceId,
    });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Post('csv/preview')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Upload a CSV file (as text): parse report plus the usual validation and duplicate preview' })
  async previewCsv(@Body() body: { csv: string; mapping?: Record<string, string> }) {
    const { rows, report } = readCsvUpload(body?.csv);
    const preview = await this.adminImportService.previewRows(rows, body.mapping);
    return { parse: report, preview };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('csv/submit')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Import a CSV file (as text) through the ingestion pipeline; the result links to the batch report' })
  async submitCsv(
    @CurrentUser() user: IJwtPayload,
    @Body() body: { filename?: string; csv: string; mapping?: Record<string, string>; autoPublish?: boolean; sourceId?: string },
  ) {
    const { rows, report } = readCsvUpload(body?.csv);
    const result = await this.adminImportService.submitBatch({
      filename: body.filename || 'import_batch.csv',
      rows,
      createdById: user.sub,
      mapping: body.mapping,
      autoPublish: body.autoPublish === true,
      sourceId: body.sourceId,
    });
    return {
      ...result,
      parse: report,
      report: `admin/import/operations/batches/${result.batchId}/report`,
      failedRowsCsv: result.failedCount ? `admin/import/operations/batches/${result.batchId}/failed.csv` : null,
    };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Post('publish-batch/:batchId')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Publish all approved records from an import batch into PostgreSQL' })
  async publishBatch(@CurrentUser() user: IJwtPayload, @Param('batchId') batchId: string, @Body() body: PublishBatchDto, @Req() req: Request) {
    return this.adminImportService.publishBatch(batchId, { id: user.sub, ip: req.ip ?? null, userAgent: (req.headers['user-agent'] as string) ?? null }, { allowUnreviewedSource: body?.allowUnreviewedSource === true });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Get('batches')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List historical import batches and stats' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  async getBatches(
    @Query('limit') limit = 20,
    @Query('offset') offset = 0,
  ) {
    const w = boundedWindow(limit, offset, { defaultLimit: 20, maxLimit: 200 });
    return this.adminImportService.getBatches(w.limit, w.offset);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Get('stats')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get real database business and ingestion statistics' })
  async getStats() {
    return this.adminImportService.getRealStats();
  }
}
