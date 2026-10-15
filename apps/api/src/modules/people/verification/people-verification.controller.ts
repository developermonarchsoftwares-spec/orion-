import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IJwtPayload, UserRole } from '@orion/shared';
import { CurrentUser, Roles } from '../../../auth/decorators';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { IReviewContext } from '../people-publishing.service';
import { PeopleVerificationService } from './people-verification.service';
import { DisputeClaimDto, VerifyClaimDto } from './verification.dto';

const actor = (user: IJwtPayload, note?: string): IReviewContext => ({
  reviewedBy: user.email || user.sub,
  reviewerId: user.sub,
  note: note?.trim() || undefined,
});

/**
 * INTERNAL verification API (never customer-facing). Verification is not publication: these routes
 * never approve, publish or unpublish anything.
 * Read: SUPER_ADMIN, ADMIN, DATA_MANAGER (same as review). Verify / dispute: SUPER_ADMIN, ADMIN.
 */
@ApiTags('Internal / People Verification')
@ApiBearerAuth()
@Controller('internal/people-verification')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PeopleVerificationController {
  constructor(private readonly verification: PeopleVerificationService) {}

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.DATA_MANAGER)
  @Get('roles/:id')
  @ApiOperation({ summary: 'Field-by-field verification state of a role (identity, relationship, title, contacts, LinkedIn)' })
  panel(@Param('id', ParseUUIDPipe) id: string) {
    return this.verification.getPanel(id).then((claims) => ({ claims }));
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Post('roles/:id/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify ONE claim against evidence. Does not approve or publish anything.' })
  async verify(@CurrentUser() user: IJwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VerifyClaimDto) {
    const result = await this.verification.verify(id, dto, actor(user, dto.note));
    return { ...result, claims: await this.verification.getPanel(id) };
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Post('roles/:id/dispute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark ONE claim as disputed (audited, reason required)' })
  async dispute(@CurrentUser() user: IJwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DisputeClaimDto) {
    const result = await this.verification.dispute(id, dto, actor(user, dto.note));
    return { ...result, claims: await this.verification.getPanel(id) };
  }
}
