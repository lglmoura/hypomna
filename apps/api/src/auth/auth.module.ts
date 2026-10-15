import { Module, OnModuleDestroy } from '@nestjs/common';

import { closeAuthSessionCache } from '../lib/auth.js';
import { SessionCacheModule } from '../lib/session-cache/session-cache.module.js';
import { AuthController } from './auth.controller.js';
import { SessionGuard } from './session.guard.js';

@Module({
  imports: [SessionCacheModule],
  controllers: [AuthController],
  providers: [SessionGuard],
  exports: [SessionGuard],
})
export class AuthModule implements OnModuleDestroy {
  async onModuleDestroy(): Promise<void> {
    await closeAuthSessionCache();
  }
}
