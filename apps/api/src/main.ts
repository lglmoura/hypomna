import 'dotenv/config';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';
import { env } from './config/env.js';

const bootstrap = async () => {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: [
      process.env.WEB_BASE_URL ?? 'http://localhost:3000',
      process.env.WEB_ADMIN_BASE_URL ?? 'http://localhost:3001',
      process.env.WEB_MARKETING_BASE_URL ?? 'http://localhost:3002',
    ].filter((origin): origin is string => Boolean(origin)),
    credentials: true,
  });
  await app.listen(env.PORT);
};

await bootstrap();
