import { Module } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { BillingController } from './billing.controller';
import { PaymentService } from './payment.service';
import { BillingService } from './billing.service';
import { RazorpayService } from './razorpay.service';
import { TierGuard } from './tier.guard';
import { CreditModule } from '../credit/credit.module';

@Module({
  imports: [CreditModule],
  controllers: [PaymentController, BillingController],
  providers: [RazorpayService, BillingService, PaymentService, TierGuard],
  exports: [RazorpayService, BillingService, PaymentService, TierGuard],
})
export class PaymentModule {}
