import { execFileSync } from 'node:child_process';

import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';

// PRD §7.1: e2e runs against a real, disposable Postgres, never the docker-compose.yml one.
// `migrate deploy` only applies pending migrations and runs against this container alone.
const POSTGRES_IMAGE = 'postgres:16-alpine';

let container: StartedPostgreSqlContainer | undefined;

const applyMigrations = (databaseUrl: string) => {
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });
};

export const setup = async (project: TestProject) => {
  container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  const databaseUrl = container.getConnectionUri();
  applyMigrations(databaseUrl);
  project.provide('databaseUrl', databaseUrl);
};

export const teardown = async () => {
  await container?.stop();
};

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}
