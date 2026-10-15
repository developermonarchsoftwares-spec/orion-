import { Module } from '@nestjs/common';
import { CompanyResolverService } from './company-resolver.service';

/** Shared, read-only company resolution. Import this module wherever a company must be identified from external data. */
@Module({
  providers: [CompanyResolverService],
  exports: [CompanyResolverService],
})
export class CompanyResolutionModule {}
