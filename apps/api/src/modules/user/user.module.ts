import { Module, forwardRef } from '@nestjs/common';
import { UserRepository } from './user.repository';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { CreditModule } from '../credit/credit.module';

@Module({
  imports: [forwardRef(() => CreditModule)],
  controllers: [UserController],
  providers: [UserRepository, UserService],
  exports: [UserRepository, UserService],
})
export class UserModule {}
