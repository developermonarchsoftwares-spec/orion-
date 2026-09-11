import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';
import { IStorageUploadResult, IStoragePresignedUrlResult } from '@orion/shared';
import {
  IStorageService,
  IUploadOptions,
  IPresignedUrlOptions,
} from '../interfaces/storage-service.interface';

@Injectable()
export class S3CompatibleStorageProvider implements IStorageService {
  private readonly logger = new Logger(S3CompatibleStorageProvider.name);
  private readonly s3Client: S3Client;
  private readonly bucket: string;
  private readonly publicUrlPrefix?: string;

  constructor(private readonly configService: ConfigService) {
    const provider = this.configService.get<string>('storage.provider', 'minio');
    const region = this.configService.get<string>('storage.region', 'us-east-1');
    const endpoint = this.configService.get<string>('storage.endpoint');
    const accessKeyId = this.configService.get<string>('storage.accessKeyId');
    const secretAccessKey = this.configService.get<string>('storage.secretAccessKey');
    const forcePathStyle = this.configService.get<boolean>('storage.forcePathStyle', true);

    this.bucket = this.configService.get<string>('storage.bucket', 'orion-assets');
    this.publicUrlPrefix = this.configService.get<string>('storage.publicUrlPrefix');

    this.logger.log(
      `Initializing storage provider: ${provider} (Bucket: ${this.bucket}, Endpoint: ${endpoint || 'AWS Standard'})`,
    );

    this.s3Client = new S3Client({
      region,
      endpoint: endpoint || undefined,
      credentials:
        accessKeyId && secretAccessKey
          ? {
              accessKeyId,
              secretAccessKey,
            }
          : undefined,
      forcePathStyle,
    });
  }

  async uploadFile(options: IUploadOptions): Promise<IStorageUploadResult> {
    const { key, buffer, mimeType, metadata } = options;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
      Metadata: metadata,
    });

    const response = await this.s3Client.send(command);

    const url = this.publicUrlPrefix
      ? `${this.publicUrlPrefix}/${key}`
      : `https://${this.bucket}.s3.amazonaws.com/${key}`;

    return {
      key,
      url,
      bucket: this.bucket,
      size: buffer.length,
      mimeType,
      etag: response.ETag,
    };
  }

  async getDownloadUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return getSignedUrl(this.s3Client, command, { expiresIn: expiresInSeconds });
  }

  async getUploadPresignedUrl(
    options: IPresignedUrlOptions,
  ): Promise<IStoragePresignedUrlResult> {
    const { key, mimeType, expiresInSeconds = 900 } = options;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: mimeType,
    });

    const uploadUrl = await getSignedUrl(this.s3Client, command, {
      expiresIn: expiresInSeconds,
    });

    return {
      uploadUrl,
      key,
      expiresInSeconds,
    };
  }

  async deleteFile(key: string): Promise<boolean> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      await this.s3Client.send(command);
      return true;
    } catch (error) {
      this.logger.error(`Failed to delete storage file with key: ${key}`, error);
      return false;
    }
  }

  async getFileStream(key: string): Promise<Readable> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    const response = await this.s3Client.send(command);
    return response.Body as Readable;
  }

  async checkHealth(): Promise<boolean> {
    try {
      const command = new HeadBucketCommand({
        Bucket: this.bucket,
      });
      await this.s3Client.send(command);
      return true;
    } catch (error) {
      this.logger.warn(`Storage health check failed: ${(error as Error).message}`);
      return false;
    }
  }
}
