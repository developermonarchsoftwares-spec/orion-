import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IJwtPayload, UserRole } from '@orion/shared';
import { CurrentUser, Roles } from '../../../auth/decorators';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { OpsBatchesQueryDto, OpsRecordsQueryDto } from '../dto/import-operations.dto';
import { ImportOperationsService } from '../services/import-operations.service';

/**
 * INTERNAL upload operations (Phase 6.13). Same audience as the upload itself: SUPER_ADMIN and ADMIN only. Customers and anonymous
 * callers are refused by the guards. Read-only except `reprocess-people`, which re-runs the existing People stage for errored rows.
 */
@ApiTags('Admin Ingestion & Data Quality')
@ApiBearerAuth()
@Controller('admin/import/operations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ImportOperationsController {
  constructor(private readonly ops: ImportOperationsService) {}

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Get('batches')
  @ApiOperation({ summary: 'Upload batches: status, source, row counts, People outcome (filter by status, date, file name; paginated)' })
  list(@Query() query: OpsBatchesQueryDto) {
    return this.ops.listBatches(query);
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Get('batches/:batchId')
  @ApiOperation({ summary: 'One batch: reason-code totals and row-level outcomes (counts and codes only, no raw payload)' })
  detail(@Param('batchId', ParseUUIDPipe) batchId: string, @Query() query: OpsRecordsQueryDto) {
    return this.ops.getBatchDetail(batchId, query);
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Post('batches/:batchId/reprocess-people')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Re-run the People stage of published rows whose People result errored, through the existing ingestion (idempotent)' })
  reprocess(@CurrentUser() user: IJwtPayload, @Param('batchId', ParseUUIDPipe) batchId: string) {
    return this.ops.reprocessPeople(batchId, { userId: user.sub });
  }
}
