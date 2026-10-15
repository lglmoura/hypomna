import { Module } from '@nestjs/common';

import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { DbModule } from './db/db.module.js';
import { RateLimitModule } from './lib/rate-limit/rate-limit.module.js';
import { SessionCacheModule } from './lib/session-cache/session-cache.module.js';
import { QueueModule } from './queue/queue.module.js';

@Module({
  imports: [
    AuthModule,
    QueueModule,
    RateLimitModule,
    SessionCacheModule,
    DbModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
