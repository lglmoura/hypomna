import { type Env, parseEnv } from './env-schema.js';

export { type Env, envSchema, parseEnv } from './env-schema.js';

export const env: Env = parseEnv(process.env);
