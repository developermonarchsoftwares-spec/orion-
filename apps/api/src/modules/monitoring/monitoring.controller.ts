import { Controller, Get, HttpStatus, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { timingSafeEqual } from 'crypto';
import type { Request, Response } from 'express';
import { IJwtPayload, UserRole } from '@orion/shared';
import { BusinessException } from '../../common/errors/business.exception';
import { errorTracker } from '../../common/observability/error-tracker';
import { metrics } from '../../common/observability/metrics';
import { tracer } from '../../common/observability/tracing';
import { CurrentUser, Public, Roles } from '../../auth/decorators';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { DASHBOARD_HTML } from './dashboard.html';
import { htmlPageCsp } from '../../common/http/security-headers';
import { MonitoringService } from './monitoring.service';

const ADMINS = [UserRole.SUPER_ADMIN, UserRole.ADMIN];

@ApiTags('Monitoring')
@Controller('monitoring')
export class MonitoringController {
  constructor(private readonly monitoring: MonitoringService) {}

  /** The page only; it holds no data and asks for an administrator token. */
  @Public()
  @Get('dashboard')
  @ApiOperation({ summary: 'System dashboard (HTML). Sign in with an administrator access token.' })
  dashboard(@Res() res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    res.setHeader('Content-Security-Policy', htmlPageCsp(DASHBOARD_HTML)); // its one inline script allowed by hash, nothing external
    res.type('html').send(DASHBOARD_HTML);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ADMINS)
  @Get('overview')
  @ApiOperation({ summary: 'Admin: status, HTTP and process performance, database, queues, search, alerts, error tracking and tracing in one report' })
  overview(@Query('fresh') fresh?: string) {
    return this.monitoring.overview(fresh === 'true');
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ADMINS)
  @Get('database')
  @ApiOperation({ summary: 'Admin: database health (latency, pool, connections, locks, size, cache hit ratio, dead tuples, migrations)' })
  database(@Query('fresh') fresh?: string) {
    return this.monitoring.database(fresh === 'true');
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ADMINS)
  @Get('queues')
  @ApiOperation({ summary: 'Admin: queue depth, oldest waiting job, stuck jobs, throughput, failure rate and recent failures per queue' })
  queues(@Query('fresh') fresh?: string) {
    return this.monitoring.queues(fresh === 'true');
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ADMINS)
  @Get('search')
  @ApiOperation({ summary: 'Admin: search cluster health, version, resources, per-collection documents, and drift from the database' })
  search(@Query('fresh') fresh?: string) {
    return this.monitoring.search(fresh === 'true');
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ADMINS)
  @Get('alerts')
  @ApiOperation({ summary: 'Admin: the alerts firing now' })
  async alerts() {
    const alerts = await this.monitoring.alerts(true);
    return { status: this.monitoring.statusOf(alerts), alerts };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ADMINS)
  @Get('errors')
  @ApiOperation({ summary: 'Admin: recent captured errors (grouped, scrubbed), whether or not an error-tracking service is configured' })
  errors(@Query('limit') limit = '50') {
    return { tracking: errorTracker.summary(), errors: errorTracker.recent(Number(limit)) };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ADMINS)
  @Post('test-error')
  @ApiOperation({ summary: 'Admin: send a test error to the error tracker to check the wiring (a warning-level event, not a failure)' })
  async testError(@CurrentUser() user: IJwtPayload) {
    const eventId = errorTracker.capture(new Error('Orion monitoring test error (safe to ignore)'), { source: 'test', level: 'warning', userId: user.sub });
    await errorTracker.flush(3000);
    return { eventId, ...errorTracker.summary() };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ADMINS)
  @Get('traces')
  @ApiOperation({ summary: 'Admin: the slowest recent requests, each with its trace id' })
  traces(@Query('limit') limit = '20', @Query('minMs') minMs = '0') {
    return { tracing: tracer.summary(), slowest: tracer.slowRequests(Number(limit), Number(minMs)) };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ADMINS)
  @Get('traces/:traceId')
  @ApiOperation({ summary: 'Admin: every recorded span of one trace (operation names and timings only; no SQL, no URLs with queries)' })
  trace(@Param('traceId') traceId: string) {
    if (!/^[0-9a-f]{32}$/i.test(traceId)) throw new BusinessException('A trace id is 32 hexadecimal characters', 'INVALID_TRACE_ID', HttpStatus.BAD_REQUEST);
    const spans = tracer.getTrace(traceId.toLowerCase());
    if (!spans.length) throw new BusinessException('No spans of that trace are held (it is old, was never recorded, or ran on another instance)', 'TRACE_NOT_FOUND', HttpStatus.NOT_FOUND);
    return { traceId, spans: spans.map(({ _p, ...s }) => s) };
  }
}

/**
 * Prometheus scrape endpoint. Not public: send `Authorization: Bearer <METRICS_TOKEN>` (set METRICS_TOKEN in the environment, for the
 * scraper), or an administrator access token. With neither, it answers 401, so metrics are never exposed by default.
 */
@ApiTags('Monitoring')
@Controller('metrics')
export class MetricsController {
  constructor(private readonly monitoring: MonitoringService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Prometheus metrics (text exposition format). Needs METRICS_TOKEN or an administrator token.' })
  async scrape(@Req() req: Request, @Res() res: Response) {
    const user = (req as any).user as { role?: string } | undefined;
    const isAdmin = user?.role === UserRole.ADMIN || user?.role === UserRole.SUPER_ADMIN;
    const configured = process.env.METRICS_TOKEN ?? '';
    const given = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization ?? ''))?.[1] ?? '';
    const tokenOk = configured.length >= 16 && given.length === configured.length && timingSafeEqual(Buffer.from(given), Buffer.from(configured));
    if (!isAdmin && !tokenOk) throw new BusinessException('A metrics token or an administrator token is required', 'UNAUTHORIZED', HttpStatus.UNAUTHORIZED);
    await this.monitoring.refreshSnapshots();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8'); // the exact form Prometheus documents (res.type() would reorder the parameters)
    res.end(metrics.render());
  }
}
