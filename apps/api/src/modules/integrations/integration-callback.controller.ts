import { Controller, HttpCode, HttpStatus, Param, Post, RawBodyRequest, Req, Headers, HttpException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { and, eq } from 'drizzle-orm';
import type { Request } from 'express';
import { Inject } from '@nestjs/common';
import { Public } from '../../auth/decorators';
import { DRIZZLE_DATABASE } from '../../database/database.constants';
import { DrizzleDb } from '../../database/database.provider';
import * as schema from '../../database/schema';
import { verifySignature } from './integration.constants';
import { IntegrationsService } from './integrations.service';

const unauthorized = () => new HttpException({ statusCode: 401, message: 'Invalid signature', errorCode: 'INVALID_SIGNATURE' }, HttpStatus.UNAUTHORIZED);
const badRequest = (message: string) => new HttpException({ statusCode: 400, message, errorCode: 'INVALID_CALLBACK' }, HttpStatus.BAD_REQUEST);

/**
 * Inbound API callback. A webhook delivery only proves the request reached the receiver; the receiver may process it later. It reports the
 * real outcome here: `POST /integrations/callbacks/:integrationId` with `{deliveryId, status: PROCESSED | REJECTED, message?}`, signed with
 * the integration's signing secret exactly as Orion signs its deliveries (`X-Orion-Signature: t=..,v1=..` over `${t}.${rawBody}`).
 * A request older or newer than 5 minutes is refused, which bounds replay of a captured one. An unknown integration and a bad signature
 * answer identically. The report feeds the delivery log and the reconciliation in `POST /integrations/:id/validate`.
 */
@ApiTags('Integrations')
@Controller('integrations/callbacks')
export class IntegrationCallbackController {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: DrizzleDb,
    private readonly integrations: IntegrationsService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  @Post(':integrationId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receiver reports the outcome of a delivery (signed with the integration signing secret)' })
  async callback(@Param('integrationId') integrationId: string, @Headers('x-orion-signature') signature: string, @Req() req: RawBodyRequest<Request>) {
    const raw = req.rawBody;
    if (!raw || !raw.length || !/^[0-9a-f-]{36}$/i.test(integrationId)) throw unauthorized();
    const [integ] = await this.db.select().from(schema.integrations).where(eq(schema.integrations.id, integrationId)).limit(1);
    if (!integ || !verifySignature(this.integrations.signingSecretOf(integ), raw, signature)) throw unauthorized();

    let body: any;
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      throw badRequest('The body is not JSON');
    }
    if (!body || typeof body.deliveryId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.deliveryId) || !['PROCESSED', 'REJECTED'].includes(body.status)) {
      throw badRequest('Expected {deliveryId, status: PROCESSED | REJECTED, message?}');
    }
    const rows = await this.db
      .update(schema.integrationDeliveries)
      .set({ ackStatus: body.status, ackMessage: typeof body.message === 'string' ? body.message.slice(0, 300) : null, ackedAt: new Date() })
      .where(and(eq(schema.integrationDeliveries.id, body.deliveryId), eq(schema.integrationDeliveries.integrationId, integrationId)))
      .returning({ id: schema.integrationDeliveries.id });
    if (!rows.length) throw new HttpException({ statusCode: 404, message: 'Unknown delivery', errorCode: 'DELIVERY_NOT_FOUND' }, HttpStatus.NOT_FOUND);
    return { success: true };
  }
}
