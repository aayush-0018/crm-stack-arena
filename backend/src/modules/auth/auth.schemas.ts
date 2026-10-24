import { z } from 'zod';

export const registerSchema = z.object({
  shopName: z.string().trim().min(1, 'Shop name is required').max(120),
  name: z.string().trim().min(1, 'Your name is required').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(72),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});
