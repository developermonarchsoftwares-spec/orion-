import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IJwtPayload, UserRole } from '@orion/shared';
import { CurrentUser, Roles } from '../../../auth/decorators';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { IReviewContext } from '../people-publishing.service';
import { PeopleQuarantineService } from './people-quarantine.service';
import { PeopleReviewService } from './people-review.service';
import { PeopleTriageService } from './people-triage.service';
import {
  ApproveDto,
  EditAndApproveDto,
  QuarantineQueryDto,
  QuarantineSuppressDto,
  ReasonDto,
  RetryPatchDto,
  ReviewQueueQueryDto,
  RoleEditDto,
  TriageQueryDto,
} from './review.dto';

const actor = (user: IJwtPayload, reason?: string): IReviewContext => ({
  reviewedBy: user.email || user.sub,
  reviewerId: user.sub,
  note: reason?.trim() || undefined,
});

/**
 * INTERNAL people review API. Not customer-facing: every route requires an authenticated internal role.
 * Read (queue, detail, quarantine list): SUPER_ADMIN, ADMIN, DATA_MANAGER.
 * Change (approve, edit, reject, quarantine, reopen, unpublish, suppress, publish/unpublish contact, retry, resolve): SUPER_ADMIN, ADMIN.
 * Business rules live in PeoplePublishingService / PeopleReviewService, not here.
 */
@ApiTags('Internal / People Review')
@ApiBearerAuth()
@Controller('internal/people-review')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PeopleReviewController {
  constructor(
    private readonly review: PeopleReviewService,
    private readonly quarantine: PeopleQuarantineService,
    private readonly triage: PeopleTriageService,
  ) {}

  // ---------------------------------------------------------------- read
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.DATA_MANAGER)
  @Get('stats')
  @ApiOperation({ summary: 'Counts of roles per review state and quarantine items per status' })
  stats() {
    return this.review.getStats();
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.DATA_MANAGER)
  @Get('queue')
  @ApiOperation({ summary: 'Review queue of people roles (default: pending)' })
  queue(@Query() query: ReviewQueueQueryDto) {
    return this.review.getQueue(query);
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.DATA_MANAGER)
  @Get('triage')
  @ApiOperation({ summary: 'Read-only triage list over existing quality signals (quarantine, conflicts, verification disputes, unclassified titles)' })
  triageList(@Query() query: TriageQueryDto) {
    return this.triage.list(query);
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.DATA_MANAGER)
  @Get('roles/:id')
  @ApiOperation({ summary: 'Reviewer detail: identity, contacts, quality, all evidence, other roles, audit trail' })
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.review.getRoleDetail(id);
  }

  // ---------------------------------------------------------------- role actions
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Post('roles/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Publish THIS role (and only the named contacts of this person)' })
  approve(@CurrentUser() user: IJwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ApproveDto) {
    return this.review.approve(id, actor(user, dto.reason), dto);
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Patch('roles/:id')
  @ApiOperation({ summary: 'Audited correction of name, title, classification, current/former, dates, contacts (reason required)' })
  async edit(@CurrentUser() user: IJwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RoleEditDto) {
    const result = await this.review.editRole(id, dto, actor(user, dto.reason));
    return { ...result, detail: await this.review.getRoleDetail(id) };
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Post('roles/:id/edit-and-approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Edit and publish this role in one atomic step' })
  async editAndApprove(@CurrentUser() user: IJwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EditAndApproveDto) {
    const result = await this.review.editRole(id, dto, actor(user, dto.reason), { publishContactIds: dto.publishContactIds });
    return { ...result, detail: await this.review.getRoleDetail(id) };
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Post('roles/:id/reject')
  @HttpCode(HttpStatus.OK)
  reject(@CurrentUser() user: IJwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.review.reject(id, actor(user, dto.reason));
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Post('roles/:id/quarantine')
  @HttpCode(HttpStatus.OK)
  quarantineRole(@CurrentUser() user: IJwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.review.quarantine(id, actor(user, dto.reason));
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Post('roles/:id/reopen')
  @HttpCode(HttpStatus.OK)
  reopen(@CurrentUser() user: IJwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.review.reopen(id, actor(user, dto.reason));
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Post('roles/:id/unpublish')
  @HttpCode(HttpStatus.OK)
  unpublish(@CurrentUser() user: IJwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.review.unpublish(id, actor(user, dto.reason));
  }

  // ---------------------------------------------------------------- person / contact actions
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Post('people/:personId/suppress')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Hide the person everywhere and block re-ingestion' })
  suppress(@CurrentUser() user: IJwtPayload, @Param('personId', ParseUUIDPipe) personId: string, @Body() dto: ReasonDto) {
    return this.review.suppressPerson(personId, actor(user, dto.reason));
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Post('contacts/:id/publish')
  @HttpCode(HttpStatus.OK)
  publishContact(@CurrentUser() user: IJwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.review.publishContact(id, actor(user, dto.reason));
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Post('contacts/:id/unpublish')
  @HttpCode(HttpStatus.OK)
  unpublishContact(@CurrentUser() user: IJwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.review.unpublishContact(id, actor(user, dto.reason));
  }

  // ---------------------------------------------------------------- quarantine
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.DATA_MANAGER)
  @Get('quarantine')
  @ApiOperation({ summary: 'Quarantined people records (default: pending)' })
  quarantineList(@Query() query: QuarantineQueryDto) {
    return this.quarantine.list(query);
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.DATA_MANAGER)
  @Get('quarantine/:id')
  @ApiOperation({ summary: 'Raw + normalized payload, reasons, validation errors, company match, identity candidates' })
  quarantineDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.quarantine.getDetail(id);
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Post('quarantine/:id/resolve')
  @HttpCode(HttpStatus.OK)
  resolve(@CurrentUser() user: IJwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.quarantine.resolve(id, actor(user, dto.reason));
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Post('quarantine/:id/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Explicit re-attempt, optionally with corrected identifying fields. Never automatic.' })
  retry(@CurrentUser() user: IJwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RetryPatchDto) {
    return this.quarantine.retry(id, actor(user, dto.reason), dto.patch);
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Post('quarantine/:id/reject')
  @HttpCode(HttpStatus.OK)
  rejectQuarantine(@CurrentUser() user: IJwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.quarantine.reject(id, actor(user, dto.reason));
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Post('quarantine/:id/suppress')
  @HttpCode(HttpStatus.OK)
  suppressQuarantine(@CurrentUser() user: IJwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: QuarantineSuppressDto) {
    return this.quarantine.suppress(id, actor(user, dto.reason), dto.personId);
  }
}
