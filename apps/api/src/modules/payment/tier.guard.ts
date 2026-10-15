import { CanActivate, ExecutionContext, HttpStatus, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BusinessException } from '../../common/errors/business.exception';
import { BillingService, TIER_ORDER } from './billing.service';

export const REQUIRED_TIER_KEY = 'requiredTier';

/**
 * Restricts a route to customers on `tier` or above (free < starter < growth < agency < enterprise). Use together with the JWT
 * guard: `@UseGuards(JwtAuthGuard, TierGuard) @RequireTier('growth')`. The importing module must import PaymentModule.
 * An expired or cancelled plan counts as free. Responds 403 TIER_REQUIRED with the tier needed and the tier held.
 */
export const RequireTier = (tier: (typeof TIER_ORDER)[number]) => SetMetadata(REQUIRED_TIER_KEY, tier);

@Injectable()
export class TierGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly billing: BillingService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string | undefined>(REQUIRED_TIER_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!required) return true;
    const userId = ctx.switchToHttp().getRequest()?.user?.sub;
    if (!userId) throw new BusinessException('Authentication required', 'UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const sub = await this.billing.getSubscription(userId);
    if (!(await this.billing.hasTier(userId, required))) {
      throw new BusinessException(`This feature needs the ${required} plan or higher`, 'TIER_REQUIRED', HttpStatus.FORBIDDEN, { requiredTier: required, currentTier: sub.tier });
    }
    return true;
  }
}
