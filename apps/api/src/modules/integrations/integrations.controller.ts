import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { IJwtPayload, UserRole } from '@orion/shared';
import { BusinessException } from '../../common/errors/business.exception';
import { CurrentUser, Roles } from '../../auth/decorators';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { CrmSyncService } from './crm/crm-sync.service';
import { CreateIntegrationDto, DeliveriesQueryDto, SyncDto, UpdateIntegrationDto, ValidateDto } from './dto/integration.dto';
import { SUBSCRIBABLE_EVENTS } from './integration.constants';
import { IntegrationsService, IRequestContext } from './integrations.service';
import { WebhookDispatcherService } from './webhook-dispatcher.service';

const ctxOf = (req: Request): IRequestContext => ({ ip: req.ip ?? null, userAgent: (req.headers['user-agent'] as string) ?? null });

@ApiTags('Integrations')
@ApiBearerAuth()
@Controller('integrations')
@UseGuards(JwtAuthGuard)
export class IntegrationsController {
  constructor(
    private readonly integrations: IntegrationsService,
    private readonly dispatcher: WebhookDispatcherService,
    private readonly crm: CrmSyncService,
  ) {}

  @Get('events')
  @ApiOperation({ summary: 'Events a webhook can subscribe to' })
  events() {
    return SUBSCRIBABLE_EVENTS;
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Get('admin/health')
  @ApiOperation({ summary: 'Admin: integration health across all customers: problem integrations and delivery backlog' })
  adminHealth() {
    return this.integrations.adminHealth();
  }

  @Get()
  @ApiOperation({ summary: 'Your integrations with their health' })
  list(@CurrentUser() user: IJwtPayload) {
    return this.integrations.list(user.sub);
  }

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Connect a webhook endpoint or a CRM. The signing secret is returned once.' })
  create(@CurrentUser() user: IJwtPayload, @Body() dto: CreateIntegrationDto, @Req() req: Request) {
    return this.integrations.create(user.sub, dto, ctxOf(req));
  }

  @Get(':id')
  @ApiOperation({ summary: 'One integration' })
  get(@CurrentUser() user: IJwtPayload, @Param('id') id: string) {
    return this.integrations.get(user.sub, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename, change endpoint / events / token, pause, or switch back on' })
  update(@CurrentUser() user: IJwtPayload, @Param('id') id: string, @Body() dto: UpdateIntegrationDto, @Req() req: Request) {
    return this.integrations.update(user.sub, id, dto, ctxOf(req));
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove an integration and its delivery history' })
  remove(@CurrentUser() user: IJwtPayload, @Param('id') id: string, @Req() req: Request) {
    return this.integrations.remove(user.sub, id, ctxOf(req));
  }

  @Post(':id/rotate-secret')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Issue a new signing secret (returned once). The old one stops working immediately.' })
  rotate(@CurrentUser() user: IJwtPayload, @Param('id') id: string, @Req() req: Request) {
    return this.integrations.rotateSecret(user.sub, id, ctxOf(req));
  }

  @Post(':id/test')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Webhook: send a signed test event now. CRM: check the access token. Returns what happened.' })
  async test(@CurrentUser() user: IJwtPayload, @Param('id') id: string) {
    const integ = await this.integrations.getOwned(user.sub, id);
    return integ.type === 'WEBHOOK' ? this.dispatcher.sendTest(user.sub, id) : this.crm.testConnection(user.sub, id);
  }

  @Get(':id/deliveries')
  @ApiOperation({ summary: 'Delivery log of a webhook: status, attempts, last response, receiver acknowledgement' })
  deliveries(@CurrentUser() user: IJwtPayload, @Param('id') id: string, @Query() q: DeliveriesQueryDto) {
    return this.integrations.listDeliveries(user.sub, id, q);
  }

  @Post(':id/deliveries/:deliveryId/redeliver')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Put a failed or dead delivery back in the queue' })
  redeliver(@CurrentUser() user: IJwtPayload, @Param('id') id: string, @Param('deliveryId') deliveryId: string, @Req() req: Request) {
    return this.integrations.redeliver(user.sub, id, deliveryId, ctxOf(req));
  }

  @Post(':id/sync')
  @Throttle({ default: { limit: 6, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'CRM: push new, changed and previously failed unlocked leads (up to 200 per call)' })
  sync(@CurrentUser() user: IJwtPayload, @Param('id') id: string, @Body() dto: SyncDto, @Req() req: Request) {
    return this.crm.sync(user.sub, id, dto.limit, ctxOf(req));
  }

  @Post(':id/validate')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validate synchronisation: CRM vs your unlocked leads (missing / stale / failed / orphaned, optionally checked at the CRM), or webhook delivery reconciliation' })
  async validate(@CurrentUser() user: IJwtPayload, @Param('id') id: string, @Body() dto: ValidateDto) {
    const integ = await this.integrations.getOwned(user.sub, id);
    if (integ.type === 'WEBHOOK') return this.integrations.validateDeliveries(user.sub, id, dto.days);
    if (integ.type === 'HUBSPOT') return this.crm.validate(user.sub, id, { remote: dto.remote, remoteLimit: dto.remoteLimit });
    throw new BusinessException('Unsupported integration type', 'UNKNOWN_INTEGRATION_TYPE', HttpStatus.BAD_REQUEST);
  }
}
