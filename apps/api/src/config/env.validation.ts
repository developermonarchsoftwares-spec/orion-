import * as Joi from 'joi';

export const environmentValidationSchema = Joi.object({
  // App
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test', 'provision')
    .default('development'),
  PORT: Joi.number().default(4000),
  API_PREFIX: Joi.string().default('/api/v1'),
  APP_NAME: Joi.string().default('Orion Lead Intelligence Platform API'),
  APP_URL: Joi.string().uri().default('http://localhost:4000'),
  CORS_ORIGINS: Joi.string().default('http://localhost:3000,http://127.0.0.1:3000'),

  // PostgreSQL
  DATABASE_URL: Joi.string().required(),
  DB_MAX_CONNECTIONS: Joi.number().default(20),
  DB_IDLE_TIMEOUT_MS: Joi.number().default(30000),

  // Redis
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').optional(),
  REDIS_DB: Joi.number().default(0),
  REDIS_TLS: Joi.boolean().default(false),

  // Typesense
  TYPESENSE_NODES: Joi.string().default('localhost'),
  TYPESENSE_PORT: Joi.number().default(8108),
  TYPESENSE_PROTOCOL: Joi.string().valid('http', 'https').default('http'),
  TYPESENSE_API_KEY: Joi.string().required(),
  TYPESENSE_CONNECTION_TIMEOUT_SECONDS: Joi.number().default(5),

  // JWT
  JWT_ACCESS_SECRET: Joi.string().required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.string().required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),
  JWT_ISSUER: Joi.string().default('orion-api'),
  JWT_AUDIENCE: Joi.string().default('orion-client'),

  // Storage
  STORAGE_PROVIDER: Joi.string().valid('s3', 'r2', 'minio', 'local').default('minio'),
  STORAGE_BUCKET: Joi.string().required(),
  STORAGE_REGION: Joi.string().default('us-east-1'),
  STORAGE_ENDPOINT: Joi.string().allow('').optional(),
  STORAGE_ACCESS_KEY: Joi.string().allow('').optional(),
  STORAGE_SECRET_KEY: Joi.string().allow('').optional(),
  STORAGE_FORCE_PATH_STYLE: Joi.boolean().default(true),
  STORAGE_PUBLIC_URL_PREFIX: Joi.string().allow('').optional(),

  // Throttler
  THROTTLE_TTL: Joi.number().default(60),
  THROTTLE_LIMIT: Joi.number().default(100),

  // Logging
  LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly').default('info'),

  // OAuth (Sprint 16)
  GOOGLE_CLIENT_ID: Joi.string().allow('').optional(),
  GOOGLE_CLIENT_SECRET: Joi.string().allow('').optional(),
  GOOGLE_CALLBACK_URL: Joi.string().allow('').optional(),
  MICROSOFT_CLIENT_ID: Joi.string().allow('').optional(),
  MICROSOFT_CLIENT_SECRET: Joi.string().allow('').optional(),
  MICROSOFT_TENANT_ID: Joi.string().allow('').optional(),
  MICROSOFT_CALLBACK_URL: Joi.string().allow('').optional(),
});
