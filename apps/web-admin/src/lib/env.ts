import { z } from 'zod';

const envSchema = z.object({
  NEXT_PUBLIC_API_URL: z.url(),
});

export type Env = z.infer<typeof envSchema>;

// Next.js substitui as variaveis NEXT_PUBLIC_* em tempo de build, entao cada chave precisa ser referenciada explicitamente para
// continuar disponivel no client/app.
const parsed = envSchema.safeParse({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
});

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('\n');

  throw new Error(`Invalid environment variables:\n${issues}`);
}

export const env: Env = parsed.data;
