import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import * as compression from 'compression';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('OrionBootstrap');
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('app.port', 4000);
  const apiPrefix = configService.get<string>('app.apiPrefix', '/api/v1');
  const appName = configService.get<string>('app.appName', 'Orion Backend API');
  const corsOrigins = configService.get<string[]>('app.corsOrigins', ['http://localhost:3000']);

  // Graceful shutdown hooks
  app.enableShutdownHooks();

  // Security headers with Helmet
  app.use(
    helmet({
      crossOriginEmbedderPolicy: false,
      contentSecurityPolicy: {
        directives: {
          defaultSrc: [`'self'`],
          styleSrc: [`'self'`, `'unsafe-inline'`],
          imgSrc: [`'self'`, 'data:', 'validator.swagger.io'],
          scriptSrc: [`'self'`, `https: 'unsafe-inline'`],
        },
      },
    }),
  );

  // Response Compression
  app.use(compression());

  // CORS
  app.enableCors({
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'x-request-id', 'x-refresh-token'],
  });

  // Global API Prefix
  app.setGlobalPrefix(apiPrefix.replace(/^\//, ''));

  // Global Validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Swagger Documentation Setup
  const swaggerConfig = new DocumentBuilder()
    .setTitle(appName)
    .setDescription(
      'Enterprise Backend API for Orion — AI-Powered Business Discovery & Lead Intelligence Platform.\n\n' +
        'Engineered for 10M+ Business Records, High-Throughput Search, and Asynchronous Processing Queues.',
    )
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter JWT Access Token',
        in: 'header',
      },
      'JWT-auth',
    )
    .addTag('Health', 'System and infrastructure health monitoring')
    .addTag('Auth', 'Authentication infrastructure and tokens')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      filter: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });

  await app.listen(port);

  logger.log(`=======================================================`);
  logger.log(`🚀 ${appName} running in [${process.env.NODE_ENV || 'development'}] mode`);
  logger.log(`📡 Server URL: http://localhost:${port}`);
  logger.log(`📚 Swagger Docs: http://localhost:${port}/docs`);
  logger.log(`🩺 Health Check: http://localhost:${port}${apiPrefix}/health`);
  logger.log(`=======================================================`);
}

bootstrap();
