import { Module } from '@nestjs/common';

import { SessionCacheService } from './session-cache.service.js';

@Module({
  providers: [SessionCacheService],
  exports: [SessionCacheService],
})
export class SessionCacheModule {}
