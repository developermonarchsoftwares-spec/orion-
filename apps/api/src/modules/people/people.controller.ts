import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Optional,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { IJwtPayload } from '@orion/shared';
import { CurrentUser } from '../../auth/decorators';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CompanyPeopleQueryDto, PeopleExportDto, UnlockedPeopleQueryDto } from './dto/people.dto';
import { applyDownloadHeaders } from '../../common/http/download-headers';
import { Throttle } from '@nestjs/throttler';
import { PeopleExportService } from './people-export.service';
import { PeopleUnlockService } from './people-unlock.service';
import { PeopleService } from './people.service';
import { AuditLogService } from '../../common/services/audit-log.service';

@ApiTags('People / Decision Makers')
@Controller()
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PeopleController {
  constructor(
    private readonly peopleService: PeopleService,
    private readonly unlockService: PeopleUnlockService,
    private readonly exportService: PeopleExportService,
    @Optional() private readonly auditLogService?: AuditLogService,
  ) {}

  @Get(['companies/:businessId/people', 'company/:businessId/people'])
  @ApiOperation({ summary: 'People and decision makers at a company (contact values withheld until unlocked)' })
  @ApiResponse({ status: 200, description: 'Filterable, paginated people with verification and confidence' })
  listCompanyPeople(
    @CurrentUser() user: IJwtPayload,
    @Param('businessId') businessId: string,
    @Query() query: CompanyPeopleQueryDto,
  ) {
    return this.peopleService.listCompanyPeople(businessId, user.sub, query);
  }

  @Get('people/taxonomy')
  @ApiOperation({ summary: 'Departments, seniority levels and decision-maker types for filter UIs' })
  getTaxonomy() {
    return this.peopleService.getTaxonomy();
  }

  @Get('people/unlocked')
  @ApiOperation({ summary: 'People the current user has unlocked' })
  getUnlocked(@CurrentUser() user: IJwtPayload, @Query() query: UnlockedPeopleQueryDto) {
    return this.unlockService.getUnlockedPeople(user.sub, query.page, query.limit);
  }

  @Post('people/export')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Export unlocked people as CSV. Locked people are never included.' })
  async exportPeople(
    @CurrentUser() user: IJwtPayload,
    @Body() dto: PeopleExportDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const { csv, filename, rowCount, skippedLocked } = await this.exportService.exportUnlockedPeopleCsv(
      user.sub,
      dto.personIds,
    );
    await this.auditLogService?.record({
      userId: user.sub,
      action: 'EXPORT_CREATED',
      entityType: 'EXPORT',
      newValues: { dataset: 'unlocked-people', format: 'csv', source: 'ON_DEMAND', outcome: 'COMPLETED', rowCount, skippedLocked, requestedIds: dto.personIds?.length ?? 0, requestId: (req.headers['x-request-id'] as string) ?? null },
      ipAddress: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string) ?? null,
    });
    applyDownloadHeaders(res, 'text/csv; charset=utf-8', filename);
    res.setHeader('X-Export-Row-Count', String(rowCount));
    res.setHeader('X-Export-Skipped-Locked', String(skippedLocked));
    res.send(csv);
  }

  @Get('people/:personId')
  @ApiOperation({ summary: 'Person profile across companies; contacts locked unless unlocked' })
  @ApiResponse({ status: 404, description: 'Person not found or not published' })
  getPerson(@CurrentUser() user: IJwtPayload, @Param('personId', ParseUUIDPipe) personId: string) {
    return this.peopleService.getPersonDetail(personId, user.sub);
  }

  @Post('people/:personId/unlock')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unlock a person\'s published contact points using credits (idempotent)' })
  @ApiResponse({ status: 402, description: 'Insufficient credit balance' })
  @ApiResponse({ status: 409, description: 'No contact information available' })
  unlockPerson(@CurrentUser() user: IJwtPayload, @Param('personId', ParseUUIDPipe) personId: string) {
    return this.unlockService.unlockPerson(user.sub, personId);
  }
}
