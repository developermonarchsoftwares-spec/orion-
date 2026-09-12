import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  isDevelopment: process.env.NODE_ENV === 'development',
  port: parseInt(process.env.PORT || '4000', 10),
  apiPrefix: process.env.API_PREFIX || '/api/v1',
  appName: process.env.APP_NAME || 'Orion Backend API',
  appUrl: process.env.APP_URL || 'http://localhost:4000',
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',').map((o) => o.trim()),
  logLevel: process.env.LOG_LEVEL || 'info',
}));

export const databaseConfig = registerAs('database', () => ({
  url: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/orion_db',
  maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS || '20', 10),
  idleTimeoutMs: parseInt(process.env.DB_IDLE_TIMEOUT_MS || '30000', 10),
}));

export const redisConfig = registerAs('redis', () => ({
  url: process.env.REDIS_URL || undefined,
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
  db: parseInt(process.env.REDIS_DB || '0', 10),
  tls: process.env.REDIS_TLS === 'true',
}));

export const typesenseConfig = registerAs('typesense', () => ({
  nodes: (process.env.TYPESENSE_NODES || 'localhost').split(',').map((node) => ({
    host: node.trim(),
    port: parseInt(process.env.TYPESENSE_PORT || '8108', 10),
    protocol: process.env.TYPESENSE_PROTOCOL || 'http',
  })),
  apiKey: process.env.TYPESENSE_API_KEY || 'xyz123_orion_typesense_master_key',
  connectionTimeoutSeconds: parseInt(process.env.TYPESENSE_CONNECTION_TIMEOUT_SECONDS || '5', 10),
}));

export const jwtConfig = registerAs('jwt', () => ({
  accessSecret: process.env.JWT_ACCESS_SECRET || 'orion_access_secret_key_default_2026',
  accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  refreshSecret: process.env.JWT_REFRESH_SECRET || 'orion_refresh_secret_key_default_2026',
  refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  issuer: process.env.JWT_ISSUER || 'orion-api',
  audience: process.env.JWT_AUDIENCE || 'orion-client',
}));

export const storageConfig = registerAs('storage', () => {
  const provider = process.env.STORAGE_PROVIDER || 'minio';
  return {
    provider,
    bucket: process.env.STORAGE_BUCKET || (provider === 'r2' ? 'orion' : 'orion-assets'),
    region: process.env.STORAGE_REGION || (provider === 'r2' ? 'auto' : 'us-east-1'),
    endpoint: process.env.STORAGE_ENDPOINT || (provider === 'minio' ? 'http://localhost:9000' : undefined),
    accessKeyId: process.env.STORAGE_ACCESS_KEY || (provider === 'minio' ? 'minioadmin' : undefined),
    secretAccessKey: process.env.STORAGE_SECRET_KEY || (provider === 'minio' ? 'minioadmin' : undefined),
    forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE !== 'false',
    publicUrlPrefix: process.env.STORAGE_PUBLIC_URL_PREFIX || undefined,
  };
});

export const throttlerConfig = registerAs('throttler', () => ({
  ttl: parseInt(process.env.THROTTLE_TTL || '60', 10),
  limit: parseInt(process.env.THROTTLE_LIMIT || '100', 10),
}));

export * from './env.validation';

