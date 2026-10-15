import { Global, Module } from '@nestjs/common';
import { PaymentModule } from '../payment/payment.module';
import { CaptchaService } from './captcha.service';
import { TrafficController } from './traffic.controller';
import { TrafficLimitsService } from './traffic-limits.service';
import { TrafficMiddleware } from './traffic.middleware';
import { TrafficStateService } from './traffic-state.service';

/** Global so the authentication service can report failed sign-ins (an optional injection: tests that omit this module still work). */
@Global()
@Module({
  imports: [PaymentModule], // the plan (tier) a customer is on sets their allowance
  controllers: [TrafficController],
  providers: [TrafficStateService, TrafficLimitsService, CaptchaService, TrafficMiddleware],
  exports: [TrafficStateService, TrafficLimitsService, CaptchaService, TrafficMiddleware],
})
export class TrafficModule {}
