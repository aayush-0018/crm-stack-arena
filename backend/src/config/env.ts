import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('127.0.0.1'),
  DATABASE_URL: z
    .string()
    .url()
    .refine((u) => {
      const host = new URL(u).hostname;
      return host === 'localhost' || host === '127.0.0.1' || host === '::1';
    }, 'DATABASE_URL must point to a local database'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
