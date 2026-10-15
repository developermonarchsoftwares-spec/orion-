import { DEV_ONLY_DEFAULTS, productionOptional, productionRequired, resolveSecret } from './secrets';
import { registerAs } from '@nestjs/config';
import { parseCorsOrigins } from './cors';

export const appConfig = registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  isDevelopment: process.env.NODE_ENV === 'development',
  port: parseInt(process.env.PORT || '4000', 10),
  apiPrefix: process.env.API_PREFIX || '/api/v1',
  appName: process.env.APP_NAME || 'Orion Backend API',
  appUrl: process.env.APP_URL || 'http://localhost:4000',
  // production: nothing unless CORS_ORIGINS lists exact https origins (invalid entries are rejected at startup by env.validation)
  corsOrigins: parseCorsOrigins(process.env.CORS_ORIGINS, process.env.NODE_ENV === 'production').origins,
  logLevel: process.env.LOG_LEVEL || 'info',
}));

export const databaseConfig = registerAs('database', () => ({
  url: productionRequired('DATABASE_URL', DEV_ONLY_DEFAULTS.databaseUrl),
  maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS || '20', 10),
  idleTimeoutMs: parseInt(process.env.DB_IDLE_TIMEOUT_MS || '30000', 10),
}));

export const typesenseConfig = registerAs('typesense', () => ({
  nodes: (process.env.TYPESENSE_NODES || 'localhost').split(',').map((node) => ({
    host: node.trim(),
    port: parseInt(process.env.TYPESENSE_PORT || '8108', 10),
    protocol: process.env.TYPESENSE_PROTOCOL || 'http',
  })),
  // only needed (and only validated) when Typesense is the search provider
  apiKey: (process.env.SEARCH_PROVIDER || 'postgres').toLowerCase() === 'typesense'
    ? productionRequired('TYPESENSE_API_KEY', DEV_ONLY_DEFAULTS.typesenseApiKey)
    : process.env.TYPESENSE_API_KEY || DEV_ONLY_DEFAULTS.typesenseApiKey,
  connectionTimeoutSeconds: parseInt(process.env.TYPESENSE_CONNECTION_TIMEOUT_SECONDS || '5', 10),
}));

export const jwtConfig = registerAs('jwt', () => ({
  accessSecret: resolveSecret('JWT_ACCESS_SECRET'),
  accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  refreshSecret: resolveSecret('JWT_REFRESH_SECRET'),
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
    // object-storage credentials are explicit in production; the docker-compose MinIO values are for local development only
    accessKeyId: provider === 'local' ? undefined : productionOptional('STORAGE_ACCESS_KEY', DEV_ONLY_DEFAULTS.storageAccessKey),
    secretAccessKey: provider === 'local' ? undefined : productionOptional('STORAGE_SECRET_KEY', DEV_ONLY_DEFAULTS.storageSecretKey),
    forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE !== 'false',
    publicUrlPrefix: process.env.STORAGE_PUBLIC_URL_PREFIX || undefined,
  };
});

export const throttlerConfig = registerAs('throttler', () => {
  // S-09: @nestjs/throttler v6 measures `ttl` in MILLISECONDS. A value of 60 is 60ms (effectively no limit).
  // A legacy value <= 1000 is treated as seconds and converted, so existing env files keep working.
  const raw = parseInt(process.env.THROTTLE_TTL || '60000', 10);
  const ttl = Number.isFinite(raw) && raw > 0 ? (raw <= 1000 ? raw * 1000 : raw) : 60000;
  return {
    ttl,
    limit: parseInt(process.env.THROTTLE_LIMIT || '100', 10),
  };
});

export * from './env.validation';

