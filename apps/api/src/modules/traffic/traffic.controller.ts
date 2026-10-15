import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { IJwtPayload, UserRole } from '@orion/shared';
import { eq } from 'drizzle-orm';
import { Inject } from '@nestjs/common';
import { BusinessException } from '../../common/errors/business.exception';
import { CurrentUser, Roles } from '../../auth/decorators';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { DRIZZLE_DATABASE } from '../../database/database.constants';
import { DrizzleDb } from '../../database/database.provider';
import * as schema from '../../database/schema';
import { CaptchaService } from './captcha.service';
import { normalizeIp, parseIp } from './cidr.util';
import { clientIpOf } from './client-ip';
import { BlockDto, IpRuleDto, UserLimitDto } from './dto/traffic.dto';
import { trafficConfig } from './traffic.config';
import { TrafficLimitsService } from './traffic-limits.service';
import { IRequestContext, TrafficStateService } from './traffic-state.service';
import { boundedWindow } from '../../common/utils/pagination.util';

const ctxOf = (req: Request): IRequestContext => ({ ip: clientIpOf(req), userAgent: (req.headers['user-agent'] as string) ?? null });
const ADMINS = [UserRole.SUPER_ADMIN, UserRole.ADMIN];

@ApiTags('Traffic control')
@ApiBearerAuth()
@Controller('traffic')
@UseGuards(JwtAuthGuard)
export class TrafficController {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: DrizzleDb,
    private readonly state: TrafficStateService,
    private readonly limits: TrafficLimitsService,
    private readonly captcha: CaptchaService,
  ) {}

  // ---- customers ----

  @Get('my-limits')
  @ApiOperation({ summary: 'Your request allowance (from your plan, or an administrator override) and how much of it you have used' })
  async myLimits(@CurrentUser() user: IJwtPayload) {
    const u = await this.limits.usage(user.sub);
    const exempt = user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN;
    return {
      enabled: trafficConfig().enabled,
      exempt,
      plan: u.limits.tier,
      source: u.limits.source,
      perMinute: u.limits.perMinute,
      perDay: u.limits.perDay,
      burstPerSecond: u.limits.burstPerSecond,
      maxConcurrent: u.limits.maxConcurrent,
      usedLastMinute: u.usedLastMinute,
      usedLastDay: u.usedLastDay,
    };
  }

  // ---- administrators ----

  @UseGuards(RolesGuard)
  @Roles(...ADMINS)
  @Get('limits')
  @ApiOperation({ summary: 'Admin: the limits and protections in force (no secrets)' })
  effective() {
    const c = trafficConfig();
    return {
      enabled: c.enabled,
      ip: c.ip,
      user: c.user,
      abuse: c.abuse,
      login: c.login,
      captcha: { enabled: this.captcha.enabled(), provider: this.captcha.providerName(), failOpen: c.captcha.failOpen },
      extraBlockedUserAgentPatterns: c.extraBlockedUserAgents.length,
      note: 'Counters are per API instance; blocks and rules are shared through the database.',
    };
  }

  @UseGuards(RolesGuard)
  @Roles(...ADMINS)
  @Get('stats')
  @ApiOperation({ summary: 'Admin: what the protections did since this instance started, and the most limited addresses / users' })
  async stats() {
    const blocks = await this.state.listBlocks(500);
    return { ...this.limits.stats, activeBlocks: blocks.length, topLimited: this.limits.topOffenders(10) };
  }

  @UseGuards(RolesGuard)
  @Roles(...ADMINS)
  @Get('ip-rules')
  @ApiOperation({ summary: 'Admin: IP allow / deny rules' })
  ipRules() {
    return this.state.listIpRules();
  }

  @UseGuards(RolesGuard)
  @Roles(...ADMINS)
  @Post('ip-rules')
  @ApiOperation({ summary: 'Admin: add an IP rule. Refused if it would lock you out.' })
  addIpRule(@CurrentUser() user: IJwtPayload, @Body() dto: IpRuleDto, @Req() req: Request) {
    return this.state.addIpRule({ ...dto, scope: dto.scope ?? 'GLOBAL' }, user.sub, clientIpOf(req), ctxOf(req));
  }

  @UseGuards(RolesGuard)
  @Roles(...ADMINS)
  @Delete('ip-rules/:id')
  @ApiOperation({ summary: 'Admin: remove an IP rule' })
  removeIpRule(@CurrentUser() user: IJwtPayload, @Param('id') id: string, @Req() req: Request) {
    return this.state.removeIpRule(id, user.sub, ctxOf(req));
  }

  @UseGuards(RolesGuard)
  @Roles(...ADMINS)
  @Get('blocks')
  @ApiOperation({ summary: 'Admin: active temporary blocks (automatic and manual)' })
  blocks(@Query('limit') limit = '100') {
    return this.state.listBlocks(boundedWindow(limit, 0, { defaultLimit: 100, maxLimit: 500 }).limit);
  }

  @UseGuards(RolesGuard)
  @Roles(...ADMINS)
  @Post('blocks')
  @ApiOperation({ summary: 'Admin: block an address or a user for a while' })
  async block(@CurrentUser() user: IJwtPayload, @Body() dto: BlockDto, @Req() req: Request) {
    let subject = dto.subject.trim();
    if (dto.subjectType === 'IP') {
      if (!parseIp(subject)) throw new BusinessException('Enter a valid IP address', 'INVALID_IP', HttpStatus.BAD_REQUEST);
      subject = normalizeIp(subject);
      if (subject === clientIpOf(req)) throw new BusinessException('That is your own address', 'WOULD_LOCK_OUT_YOU', HttpStatus.CONFLICT);
    } else {
      if (subject === user.sub) throw new BusinessException('You cannot block yourself', 'WOULD_LOCK_OUT_YOU', HttpStatus.CONFLICT);
      const [u] = /^[0-9a-f-]{36}$/i.test(subject) ? await this.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, subject)).limit(1) : [];
      if (!u) throw new BusinessException('User not found', 'USER_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    return this.state.createBlock({ type: dto.subjectType, subject, reason: dto.reason, minutes: dto.minutes, source: 'ADMIN', adminId: user.sub, ctx: ctxOf(req) });
  }

  @UseGuards(RolesGuard)
  @Roles(...ADMINS)
  @Delete('blocks/:id')
  @ApiOperation({ summary: 'Admin: lift a block now' })
  release(@CurrentUser() user: IJwtPayload, @Param('id') id: string, @Req() req: Request) {
    return this.state.releaseBlock(id, user.sub, ctxOf(req));
  }

  @UseGuards(RolesGuard)
  @Roles(...ADMINS)
  @Get('users/:userId/limits')
  @ApiOperation({ summary: 'Admin: the limits that apply to one user, any override, and their current use' })
  async userLimits(@Param('userId') userId: string) {
    const u = await this.limits.usage(userId);
    return { override: await this.state.getOverride(userId), ...u };
  }

  @UseGuards(RolesGuard)
  @Roles(...ADMINS)
  @Put('users/:userId/limits')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: give a user their own per-minute / per-day limit instead of the plan default' })
  setUserLimit(@CurrentUser() user: IJwtPayload, @Param('userId') userId: string, @Body() dto: UserLimitDto, @Req() req: Request) {
    return this.state.setOverride(userId, dto, user.sub, ctxOf(req));
  }

  @UseGuards(RolesGuard)
  @Roles(...ADMINS)
  @Delete('users/:userId/limits')
  @ApiOperation({ summary: 'Admin: remove a user override (back to the plan default)' })
  clearUserLimit(@CurrentUser() user: IJwtPayload, @Param('userId') userId: string, @Req() req: Request) {
    return this.state.clearOverride(userId, user.sub, ctxOf(req));
  }
}
