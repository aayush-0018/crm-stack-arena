import 'dotenv/config';
import { z } from 'zod';

const isLocal = (url: string) => {
  const host = new URL(url).hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
};

const envSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(4000),
    HOST: z.string().default('127.0.0.1'),
    DATABASE_URL: z.string().url(),
    // Hosted Postgres (Supabase, Render) needs TLS, and an explicit opt-in so a
    // remote database can never be used by accident. Both default to off.
    DATABASE_SSL: z.enum(['true', 'false']).default('false'),
    ALLOW_REMOTE_DB: z.enum(['true', 'false']).default('false'),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    JWT_EXPIRES_IN: z.string().default('7d'),
    CORS_ORIGIN: z.string().default('http://localhost:5173'),
  })
  .refine((e) => e.ALLOW_REMOTE_DB === 'true' || isLocal(e.DATABASE_URL), {
    message: 'DATABASE_URL is not local. Set ALLOW_REMOTE_DB=true to use a hosted database.',
    path: ['DATABASE_URL'],
  });

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
