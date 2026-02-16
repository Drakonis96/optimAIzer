import { Router, Request, Response } from 'express';
import { serverConfig } from '../config';
import {
  authenticateUser,
  changeOwnPassword,
  createUser,
  deleteUser,
  getUserById,
  listUsers,
  updateUserAccess,
} from '../auth/users';
import {
  createUserSession,
  getSessionTokenFromRequest,
  revokeSessionByToken,
  revokeSessionsForUser,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
} from '../auth/sessions';
import { requireAdmin, requireAuth } from '../middleware/auth';

export const authRouter = Router();

const useSecureCookie = (): boolean => serverConfig.nodeEnv === 'production';

const setSessionCookie = (res: Response, token: string): void => {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: useSecureCookie(),
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
};

const clearSessionCookie = (res: Response): void => {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'strict',
    secure: useSecureCookie(),
    path: '/',
  });
};

const asTrimmedString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * POST /api/auth/login
 */
authRouter.post('/login', (req: Request, res: Response) => {
  const username = asTrimmedString(req.body?.username);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password are required.' });
    return;
  }

  const user = authenticateUser(username, password);
  if (!user) {
    res.status(401).json({ error: 'Invalid credentials.' });
    return;
  }

  const { token } = createUserSession(user.id);
  setSessionCookie(res, token);

  res.json({
    success: true,
    user,
  });
});

/**
 * POST /api/auth/logout
 */
authRouter.post('/logout', (req: Request, res: Response) => {
  const token = getSessionTokenFromRequest(req);
  if (token) {
    revokeSessionByToken(token);
  }
  clearSessionCookie(res);
  res.json({ success: true });
});

/**
 * GET /api/auth/me
 */
authRouter.get('/me', requireAuth, (req: Request, res: Response) => {
  res.json({ user: req.authUser });
});

/**
 * POST /api/auth/me/password
 */
authRouter.post('/me/password', requireAuth, (req: Request, res: Response) => {
  const user = req.authUser!;
  const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
  const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: 'Current and new password are required.' });
    return;
  }

  try {
    const updated = changeOwnPassword(user.id, currentPassword, newPassword);
    if (!updated) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    revokeSessionsForUser(user.id);
    const { token } = createUserSession(user.id);
    setSessionCookie(res, token);

    const refreshedUser = getUserById(user.id);
    res.json({ success: true, user: refreshedUser });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not change password.';
    res.status(400).json({ error: message });
  }
});

/**
 * GET /api/auth/users
 */
authRouter.get('/users', requireAdmin, (_req: Request, res: Response) => {
  res.json({ users: listUsers() });
});

/**
 * POST /api/auth/users
 */
authRouter.post('/users', requireAdmin, (req: Request, res: Response) => {
  const username = asTrimmedString(req.body?.username);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const role = req.body?.role;
  const monthlyCostLimitUsd = req.body?.monthlyCostLimitUsd;
  const modelAllowlistByProvider = req.body?.modelAllowlistByProvider;

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password are required.' });
    return;
  }

  try {
    const user = createUser({
      username,
      password,
      role,
      monthlyCostLimitUsd,
      modelAllowlistByProvider,
    });
    res.status(201).json({ success: true, user });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not create user.';
    res.status(400).json({ error: message });
  }
});

/**
 * PATCH /api/auth/users/:id
 */
authRouter.patch('/users/:id', requireAdmin, (req: Request, res: Response) => {
  const userId = asTrimmedString(req.params.id);
  if (!userId) {
    res.status(400).json({ error: 'User id is required.' });
    return;
  }

  const updated = updateUserAccess(userId, {
    role: req.body?.role,
    monthlyCostLimitUsd: req.body?.monthlyCostLimitUsd,
    modelAllowlistByProvider: req.body?.modelAllowlistByProvider,
  });

  if (!updated) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }

  res.json({ success: true, user: updated });
});

/**
 * DELETE /api/auth/users/:id
 */
authRouter.delete('/users/:id', requireAdmin, (req: Request, res: Response) => {
  const actor = req.authUser!;
  const userId = asTrimmedString(req.params.id);

  if (!userId) {
    res.status(400).json({ error: 'User id is required.' });
    return;
  }

  if (actor.id === userId) {
    res.status(400).json({ error: 'You cannot delete your own account.' });
    return;
  }

  const result = deleteUser(userId);
  if (!result.deleted) {
    res.status(400).json({ error: result.reason || 'Could not delete user.' });
    return;
  }

  revokeSessionsForUser(userId);
  res.json({ success: true });
});
