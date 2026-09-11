import { Global, Module } from '@nestjs/common';
import { typesenseProviders } from './typesense.provider';
import { TypesenseService } from './typesense.service';
import { TYPESENSE_CLIENT } from './typesense.constants';

@Global()
@Module({
  providers: [...typesenseProviders, TypesenseService],
  exports: [TYPESENSE_CLIENT, TypesenseService],
})
export class TypesenseModule {}
