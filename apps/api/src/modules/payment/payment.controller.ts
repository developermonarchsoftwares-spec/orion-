import {
  Controller,
  Get,
  Post,
  Body,
  Headers,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { PaymentService } from './payment.service';
import { CreatePaymentOrderDto, VerifyPaymentDto } from './dto/payment.dto';
import { CurrentUser, Public } from '../../auth/decorators';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { IJwtPayload } from '@orion/shared';

@ApiTags('Payments & Razorpay')
@Controller('payments')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @UseGuards(JwtAuthGuard)
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

  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Razorpay webhook listener' })
  async handleWebhook(
    @Req() req: Request,
    @Headers('x-razorpay-signature') signature: string,
    @Body() payload: any,
  ) {
    const rawBody = JSON.stringify(payload);
    return this.paymentService.handleWebhook(rawBody, signature, payload);
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
