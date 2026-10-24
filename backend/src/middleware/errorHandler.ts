import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError, isUniqueViolation } from '../lib/errors';

const UNIQUE_MESSAGES: Record<string, { code: string; field: string; message: string }> = {
  customers_shop_phone_uq: { code: 'PHONE_EXISTS', field: 'phone', message: 'A customer with this phone already exists' },
  users_email_uq: { code: 'EMAIL_EXISTS', field: 'email', message: 'An account with this email already exists' },
};

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    const details: Record<string, string> = {};
    for (const issue of err.issues) {
      const key = issue.path.join('.') || '_';
      if (!details[key]) details[key] = issue.message;
    }
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Please fix the highlighted fields', details } });
  }

  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }

  if (isUniqueViolation(err)) {
    const m = UNIQUE_MESSAGES[(err as { constraint?: string }).constraint ?? ''];
    return res.status(409).json({
      error: m
        ? { code: m.code, message: m.message, details: { [m.field]: m.message } }
        : { code: 'CONFLICT', message: 'This record already exists' },
    });
  }

  if ((err as { type?: string })?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body' } });
  }

  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } });
}
