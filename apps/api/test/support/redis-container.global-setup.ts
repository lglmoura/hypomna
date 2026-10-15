import {
  RedisContainer,
  type StartedRedisContainer,
} from '@testcontainers/redis';
import type { TestProject } from 'vitest/node';

// PRD §7.1: e2e runs against a real, disposable Redis, never the docker-compose.yml one.
const REDIS_IMAGE = 'redis:7-alpine';

let container: StartedRedisContainer | undefined;

export const setup = async (project: TestProject) => {
  container = await new RedisContainer(REDIS_IMAGE).start();
  project.provide('redisUrl', container.getConnectionUrl());
};

export const teardown = async () => {
  await container?.stop();
};

declare module 'vitest' {
  export interface ProvidedContext {
    redisUrl: string;
  }
}
