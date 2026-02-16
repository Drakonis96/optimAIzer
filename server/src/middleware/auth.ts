import { NextFunction, Request, Response } from 'express';
import { getUserById } from '../auth/users';
import { getSessionByToken, getSessionTokenFromRequest, revokeSessionByToken } from '../auth/sessions';
import { AuthUser } from '../auth/types';

const unauthorized = (res: Response): void => {
  res.status(401).json({ error: 'Authentication required.' });
};

const forbidden = (res: Response): void => {
  res.status(403).json({ error: 'Insufficient permissions.' });
};

export const attachAuthUser = (req: Request, _res: Response, next: NextFunction): void => {
  const token = getSessionTokenFromRequest(req);
  if (!token) {
    next();
    return;
  }

  const session = getSessionByToken(token);
  if (!session) {
    revokeSessionByToken(token);
    next();
    return;
  }

  const user = getUserById(session.userId);
  if (!user) {
    revokeSessionByToken(token);
    next();
    return;
  }

  req.authUser = user;
  next();
};

export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.authUser) {
    unauthorized(res);
    return;
  }
  next();
};

export const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.authUser) {
    unauthorized(res);
    return;
  }
  if (req.authUser.role !== 'admin') {
    forbidden(res);
    return;
  }
  next();
};

export const getAuthUserOrThrow = (req: Request): AuthUser => {
  if (!req.authUser) {
    throw new Error('Authentication required.');
  }
  return req.authUser;
};
