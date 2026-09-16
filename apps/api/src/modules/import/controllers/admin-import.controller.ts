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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { Response } from 'express';
import { AdminImportService } from '../services/admin-import.service';
import { CurrentUser, Public, Roles } from '../../../auth/decorators';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { IJwtPayload, UserRole } from '@orion/shared';

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
    },
  ) {
    return this.adminImportService.submitBatch({
      filename: body.filename || 'import_batch.csv',
      rows: body.rows,
      createdById: user.sub,
      mapping: body.mapping,
      autoPublish: body.autoPublish ?? true,
    });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Post('publish-batch/:batchId')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Publish all approved records from an import batch into PostgreSQL' })
  async publishBatch(@Param('batchId') batchId: string) {
    return this.adminImportService.publishBatch(batchId);
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
    return this.adminImportService.getBatches(Number(limit), Number(offset));
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
