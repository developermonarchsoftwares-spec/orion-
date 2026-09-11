import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID } from 'class-validator';

export class UnlockBusinessDto {
  @ApiProperty({ description: 'Business UUID to unlock' })
  @IsUUID()
  @IsNotEmpty()
  businessId!: string;
}
