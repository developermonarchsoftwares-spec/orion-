import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@orion/shared';
import { Roles } from '../../../auth/decorators';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { MetricsRangeDto, ProblemBatchesQueryDto } from './metrics.dto';
import { PeopleMetricsService } from './people-metrics.service';

/** INTERNAL, read-only, admin-only data quality and pipeline metrics. Never reachable by customers. */
@ApiTags('Internal / People Metrics')
@ApiBearerAuth()
@Controller('internal/people-metrics')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PeopleMetricsController {
  constructor(private readonly metrics: PeopleMetricsService) {}

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Get('overview')
  @ApiOperation({ summary: 'Factual counts over existing data: acquisition, resolution, identity, contacts, review, classification, conflicts, pipeline health' })
  overview(@Query() range: MetricsRangeDto) {
    return this.metrics.overview(range);
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Get('problem-batches')
  @ApiOperation({ summary: 'Paginated upload batches with failures, rejected rows or People-stage problems (counts only)' })
  problemBatches(@Query() query: ProblemBatchesQueryDto) {
    return this.metrics.problemBatches(query);
  }
}
