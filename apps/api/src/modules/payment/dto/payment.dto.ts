import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsOptional, IsIn } from 'class-validator';

export class CreatePaymentOrderDto {
  @ApiProperty({ example: 'growth', description: 'Selected credit package slug or ID (e.g., starter, growth, agency)' })
  @IsString()
  @IsNotEmpty()
  packageId!: string;

  @ApiPropertyOptional({ example: 'INR', description: 'Currency (default: INR)' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ example: 'monthly', enum: ['monthly', 'annual'], description: 'Billing cycle (default: monthly)' })
  @IsOptional()
  @IsIn(['monthly', 'annual'])
  billingCycle?: 'monthly' | 'annual';
}

export class VerifyPaymentDto {
  @ApiProperty({ description: 'Razorpay Order ID' })
  @IsString()
  @IsNotEmpty()
  razorpayOrderId!: string;

  @ApiProperty({ description: 'Razorpay Payment ID' })
  @IsString()
  @IsNotEmpty()
  razorpayPaymentId!: string;

  @ApiProperty({ description: 'Razorpay HMAC Signature' })
  @IsString()
  @IsNotEmpty()
  razorpaySignature!: string;

  @ApiProperty({ description: 'Package slug or ID that was purchased' })
  @IsString()
  @IsNotEmpty()
  packageId!: string;

  @ApiPropertyOptional({ example: 'monthly', enum: ['monthly', 'annual'], description: 'Billing cycle' })
  @IsOptional()
  @IsIn(['monthly', 'annual'])
  billingCycle?: 'monthly' | 'annual';
}
