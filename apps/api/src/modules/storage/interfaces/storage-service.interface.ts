import { Readable } from 'stream';
import { IStorageUploadResult, IStoragePresignedUrlResult } from '@orion/shared';

export interface IUploadOptions {
  key: string;
  buffer: Buffer;
  mimeType: string;
  metadata?: Record<string, string>;
  isPublic?: boolean;
}

export interface IPresignedUrlOptions {
  key: string;
  mimeType?: string;
  expiresInSeconds?: number;
}

export interface IStorageService {
  uploadFile(options: IUploadOptions): Promise<IStorageUploadResult>;
  getDownloadUrl(key: string, expiresInSeconds?: number): Promise<string>;
  getUploadPresignedUrl(options: IPresignedUrlOptions): Promise<IStoragePresignedUrlResult>;
  deleteFile(key: string): Promise<boolean>;
  getFileStream(key: string): Promise<Readable>;
  checkHealth(): Promise<boolean>;
}

export const STORAGE_SERVICE = 'STORAGE_SERVICE';
