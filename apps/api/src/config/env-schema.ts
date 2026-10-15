import { z } from 'zod';

const LOCALES = ['pt-BR', 'en', 'es'] as const;

const HTTP_PROTOCOL = /^https?$/;

const httpUrl = () => z.url({ protocol: HTTP_PROTOCOL });

const requiredString = () => z.string().min(1);

const localeList = z
  .string()
  .default(LOCALES.join(','))
  .transform((value) => value.split(',').map((locale) => locale.trim()))
  .pipe(z.array(z.enum(LOCALES)).min(1));

// PRD §7, "Variáveis de ambiente (iniciais)": Stripe and OpenTelemetry stay
// optional until the phases that consume them.
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  BETTER_AUTH_SECRET: requiredString(),
  API_BASE_URL: httpUrl(),
  WEB_BASE_URL: httpUrl(),
  WEB_ADMIN_BASE_URL: httpUrl(),
  WEB_MARKETING_BASE_URL: httpUrl(),
  S3_ENDPOINT: httpUrl(),
  S3_BUCKET: requiredString(),
  S3_ACCESS_KEY: requiredString(),
  S3_SECRET_KEY: requiredString(),
  SMTP_URL: z.url({ protocol: /^smtps?$/ }),
  EMAIL_FROM: z.email(),
  DEFAULT_LOCALE: z.enum(LOCALES).default('pt-BR'),
  SUPPORTED_LOCALES: localeList,
  STRIPE_SECRET_KEY: requiredString().optional(),
  STRIPE_WEBHOOK_SECRET: requiredString().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: httpUrl().optional(),
});

export type Env = z.infer<typeof envSchema>;

const formatIssues = (error: z.ZodError) =>
  error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');

export const parseEnv = (source: Record<string, string | undefined>): Env => {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    throw new Error(
      `Invalid environment variables:\n${formatIssues(parsed.error)}`,
    );
  }

  return parsed.data;
};
