import { Module } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { RazorpayService } from './razorpay.service';
import { CreditModule } from '../credit/credit.module';

@Module({
  imports: [CreditModule],
  controllers: [PaymentController],
  providers: [RazorpayService, PaymentService],
  exports: [RazorpayService, PaymentService],
})
export class PaymentModule {}
