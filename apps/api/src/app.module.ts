import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';

// Config loaders & validation
import {
  appConfig,
  databaseConfig,
  redisConfig,
  typesenseConfig,
  jwtConfig,
  storageConfig,
  throttlerConfig,
  environmentValidationSchema,
} from './config';

// Core infrastructure modules
import { CommonModule } from './common/common.module';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './modules/redis/redis.module';
import { QueueModule } from './modules/queue/queue.module';
import { TypesenseModule } from './modules/typesense/typesense.module';
import { StorageModule } from './modules/storage/storage.module';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './modules/health/health.module';

// Domain & Pipeline Modules
import { BusinessModule } from './modules/business/business.module';
import { ImportModule } from './modules/import/import.module';
import { SearchModule } from './modules/search/search.module';

// Customer Platform Modules (Sprint 4)
import { UserModule } from './modules/user/user.module';
import { DiscoverModule } from './modules/discover/discover.module';
import { SavedLeadsModule } from './modules/saved-leads/saved-leads.module';
import { SavedSearchesModule } from './modules/saved-searches/saved-searches.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { SettingsModule } from './modules/settings/settings.module';

// Credit, Unlock & Payment Modules (Sprint 5)
import { CreditModule } from './modules/credit/credit.module';
import { UnlockModule } from './modules/unlock/unlock.module';
import { PaymentModule } from './modules/payment/payment.module';

// OAuth & Enterprise Identity (Sprint 16)
import { OAuthModule } from './modules/oauth/oauth.module';

// Guards, Filters, Interceptors, Middleware
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { AuthenticationMiddleware } from './auth/auth.middleware';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        appConfig,
        databaseConfig,
        redisConfig,
        typesenseConfig,
        jwtConfig,
        storageConfig,
        throttlerConfig,
      ],
      validationSchema: environmentValidationSchema,
      validationOptions: {
        abortEarly: false,
      },
    }),

    // Rate Limiting
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.get<number>('throttler.ttl', 60),
          limit: config.get<number>('throttler.limit', 100),
        },
      ],
    }),

    // Infrastructure Modules
    CommonModule,
    DatabaseModule,
    RedisModule,
    QueueModule,
    TypesenseModule,
    StorageModule,
    AuthModule,
    HealthModule,

    // Core Domain & Processing Modules
    BusinessModule,
    ImportModule,
    SearchModule,

    // Customer Platform Modules
    UserModule,
    DiscoverModule,
    SavedLeadsModule,
    SavedSearchesModule,
    DashboardModule,
    SettingsModule,

    // Credit Engine & Unlock System
    CreditModule,
    UnlockModule,
    PaymentModule,

    // OAuth & Enterprise Identity
    OAuthModule,
  ],
  providers: [
    // Global Exception Handling
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    // Global Response Standardization
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformInterceptor,
    },
    // Global Rate Limiting Guard
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // Global JWT Authentication Guard (endpoints public by default with @Public())
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    // Global Role-Based Authorization Guard
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(RequestIdMiddleware, AuthenticationMiddleware)
      .forRoutes('*');
  }
}
