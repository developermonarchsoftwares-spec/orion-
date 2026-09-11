import { Global, Module } from '@nestjs/common';
import { STORAGE_SERVICE } from './interfaces/storage-service.interface';
import { S3CompatibleStorageProvider } from './providers/s3-storage.provider';
import { StorageService } from './storage.service';

@Global()
@Module({
  providers: [
    {
      provide: STORAGE_SERVICE,
      useClass: S3CompatibleStorageProvider,
    },
    StorageService,
  ],
  exports: [STORAGE_SERVICE, StorageService],
})
export class StorageModule {}
