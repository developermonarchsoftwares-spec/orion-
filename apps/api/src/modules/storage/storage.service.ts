import { Inject, Injectable } from '@nestjs/common';
import { Readable } from 'stream';
import { IStorageUploadResult, IStoragePresignedUrlResult } from '@orion/shared';
import {
  IStorageService,
  IUploadOptions,
  IPresignedUrlOptions,
  STORAGE_SERVICE,
} from './interfaces/storage-service.interface';

@Injectable()
export class StorageService implements IStorageService {
  constructor(
    @Inject(STORAGE_SERVICE)
    private readonly provider: IStorageService,
  ) {}

  async uploadFile(options: IUploadOptions): Promise<IStorageUploadResult> {
    return this.provider.uploadFile(options);
  }

  async getDownloadUrl(key: string, expiresInSeconds?: number): Promise<string> {
    return this.provider.getDownloadUrl(key, expiresInSeconds);
  }

  async getUploadPresignedUrl(
    options: IPresignedUrlOptions,
  ): Promise<IStoragePresignedUrlResult> {
    return this.provider.getUploadPresignedUrl(options);
  }

  async deleteFile(key: string): Promise<boolean> {
    return this.provider.deleteFile(key);
  }

  async getFileStream(key: string): Promise<Readable> {
    return this.provider.getFileStream(key);
  }

  async checkHealth(): Promise<boolean> {
    return this.provider.checkHealth();
  }
}
