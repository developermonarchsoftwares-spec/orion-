import {
  Controller,
  Get,
  Post,
  Body,
  Headers,
  Req,
  RawBodyRequest,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { PaymentService } from './payment.service';
import { CreatePaymentOrderDto, VerifyPaymentDto, CreateTopUpOrderDto, VerifyTopUpDto } from './dto/payment.dto';
import { CurrentUser, Public } from '../../auth/decorators';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { IJwtPayload } from '@orion/shared';
import { Throttle } from '@nestjs/throttler';

@ApiTags('Payments & Razorpay')
@Controller('payments')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post('create-order')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a Razorpay payment order for purchasing a credit package' })
  @ApiResponse({ status: 200, description: 'Razorpay Order ID and metadata' })
  async createOrder(
    @CurrentUser() user: IJwtPayload,
    @Body() dto: CreatePaymentOrderDto,
  ) {
    return this.paymentService.createOrder(user.sub, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Verify Razorpay payment signature and credit user wallet' })
  @ApiResponse({ status: 200, description: 'Payment verified and credits added' })
  async verifyPayment(
    @CurrentUser() user: IJwtPayload,
    @Body() dto: VerifyPaymentDto,
  ) {
    return this.paymentService.verifyPayment(user.sub, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post('topup/order')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a Razorpay order to top up N credits (price is computed server-side)' })
  async createTopUpOrder(@CurrentUser() user: IJwtPayload, @Body() dto: CreateTopUpOrderDto) {
    return this.paymentService.createTopUpOrder(user.sub, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post('topup/verify')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Verify a top-up payment and credit the wallet (once)' })
  async verifyTopUp(@CurrentUser() user: IJwtPayload, @Body() dto: VerifyTopUpDto) {
    return this.paymentService.verifyTopUp(user.sub, dto);
  }

  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Razorpay webhook listener' })
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-razorpay-signature') signature: string,
  ) {
    // The signature covers the EXACT bytes Razorpay sent. Never re-serialise the parsed body (key order / whitespace change the
    // bytes and make a genuine webhook fail, or let a different document verify). Without the raw body nothing is accepted.
    const raw = req.rawBody;
    if (!raw || raw.length === 0) return { status: 'ignored' };
    return this.paymentService.handleWebhook(raw, signature);
  }

  @UseGuards(JwtAuthGuard)
  @Get('history')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get purchase and invoice history' })
  @ApiResponse({ status: 200, description: 'List of past credit purchases' })
  async getPaymentHistory(@CurrentUser() user: IJwtPayload) {
    return this.paymentService.getPaymentHistory(user.sub);
  }
}
