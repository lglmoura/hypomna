import { randomBytes } from 'node:crypto';

import { inject } from 'vitest';

process.env.REDIS_URL = inject('redisUrl');
process.env.DATABASE_URL = inject('databaseUrl');
process.env.BETTER_AUTH_SECRET = randomBytes(32).toString('base64');
process.env.API_BASE_URL = 'http://localhost:4000';
process.env.WEB_BASE_URL = 'http://localhost:3000';
process.env.WEB_ADMIN_BASE_URL = 'http://localhost:3001';
