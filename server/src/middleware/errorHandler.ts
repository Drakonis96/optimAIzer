import { Request, Response, NextFunction } from 'express';
import { safeErrorMessage } from '../security/redact';

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  console.error('[Error]', err.message);

  // Never leak stack traces, API keys, or internal details
  res.status(500).json({
    error: 'Internal server error',
    message: safeErrorMessage(err, 'An unexpected error occurred'),
  });
}
