import * as Joi from 'joi';

export const environmentValidationSchema = Joi.object({
  // App
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test', 'provision')
    .empty('')
    .default('development'),
  PORT: Joi.number().empty('').default(4000),
  API_PREFIX: Joi.string().empty('').default('/api/v1'),
  APP_NAME: Joi.string().empty('').default('Orion Lead Intelligence Platform API'),
  APP_URL: Joi.string().uri().empty('').default('http://localhost:4000'),
  CORS_ORIGINS: Joi.string().empty('').default('http://localhost:3000,http://127.0.0.1:3000'),

  // PostgreSQL
  DATABASE_URL: Joi.string().empty('').default('postgresql://postgres:postgres@localhost:5432/orion_db'),
  DB_MAX_CONNECTIONS: Joi.number().empty('').default(20),
  DB_IDLE_TIMEOUT_MS: Joi.number().empty('').default(30000),



  // Search Provider
  SEARCH_PROVIDER: Joi.string().valid('postgres', 'typesense').empty('').default('postgres'),

  // Typesense
  TYPESENSE_NODES: Joi.string().empty('').default('localhost'),
  TYPESENSE_PORT: Joi.number().empty('').default(8108),
  TYPESENSE_PROTOCOL: Joi.string().valid('http', 'https').empty('').default('http'),
  TYPESENSE_API_KEY: Joi.string().empty('').default('xyz123_orion_typesense_master_key'),
  TYPESENSE_CONNECTION_TIMEOUT_SECONDS: Joi.number().empty('').default(5),

  // JWT
  JWT_ACCESS_SECRET: Joi.string().empty('').default('orion_super_secret_access_jwt_key_2026_change_in_production'),
  JWT_ACCESS_EXPIRES_IN: Joi.string().empty('').default('15m'),
  JWT_REFRESH_SECRET: Joi.string().empty('').default('orion_super_secret_refresh_jwt_key_2026_change_in_production'),
  JWT_REFRESH_EXPIRES_IN: Joi.string().empty('').default('7d'),
  JWT_ISSUER: Joi.string().empty('').default('orion-api'),
  JWT_AUDIENCE: Joi.string().empty('').default('orion-client'),

  // Storage
  STORAGE_PROVIDER: Joi.string().valid('s3', 'r2', 'minio', 'local').empty('').default('minio'),
  STORAGE_BUCKET: Joi.string().empty('').default('orion-assets'),
  STORAGE_REGION: Joi.string().empty('').default('us-east-1'),
  STORAGE_ENDPOINT: Joi.string().allow('').optional(),
  STORAGE_ACCESS_KEY: Joi.string().allow('').optional(),
  STORAGE_SECRET_KEY: Joi.string().allow('').optional(),
  STORAGE_FORCE_PATH_STYLE: Joi.boolean().empty('').default(true),
  STORAGE_PUBLIC_URL_PREFIX: Joi.string().allow('').optional(),

  // Throttler
  THROTTLE_TTL: Joi.number().empty('').default(60),
  THROTTLE_LIMIT: Joi.number().empty('').default(100),

  // Logging
  LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly').empty('').default('info'),

  // OAuth (Sprint 16)
  GOOGLE_CLIENT_ID: Joi.string().allow('').optional(),
  GOOGLE_CLIENT_SECRET: Joi.string().allow('').optional(),
  GOOGLE_CALLBACK_URL: Joi.string().allow('').optional(),
  MICROSOFT_CLIENT_ID: Joi.string().allow('').optional(),
  MICROSOFT_CLIENT_SECRET: Joi.string().allow('').optional(),
  MICROSOFT_TENANT_ID: Joi.string().allow('').optional(),
  MICROSOFT_CALLBACK_URL: Joi.string().allow('').optional(),
});
