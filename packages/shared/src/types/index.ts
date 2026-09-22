import { UserRole, UserStatus } from '../enums';

export interface IApiResponse<T = unknown> {
  success: boolean;
  statusCode: number;
  message: string;
  data: T;
  meta?: Record<string, unknown>;
  timestamp: string;
}

export interface IPaginationMeta {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface IPaginatedResponse<T = unknown> extends IApiResponse<T[]> {
  pagination: IPaginationMeta;
}

export interface ICursorPaginationMeta {
  limit: number;
  hasNextPage: boolean;
  nextCursor: string | null;
  previousCursor: string | null;
}

export interface ICursorPaginatedResponse<T = unknown> extends IApiResponse<T[]> {
  cursor: ICursorPaginationMeta;
}

export interface IJwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  organizationId?: string | null;
  sessionId?: string;
  iat?: number;
  exp?: number;
}

export interface IRefreshTokenPayload {
  sub: string;
  tokenId: string;
  iat?: number;
  exp?: number;
}

export interface IStorageUploadResult {
  key: string;
  url: string;
  bucket: string;
  size: number;
  mimeType: string;
  etag?: string;
}

export interface IStoragePresignedUrlResult {
  uploadUrl: string;
  key: string;
  expiresInSeconds: number;
}
