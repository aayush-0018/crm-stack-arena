export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Record') => new AppError(404, 'NOT_FOUND', `${what} not found`);

export const isUniqueViolation = (err: unknown, constraint?: string): boolean => {
  const e = err as { code?: string; constraint?: string };
  return e?.code === '23505' && (!constraint || e.constraint === constraint);
};
