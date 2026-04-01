import type { NextFunction, Request, Response } from 'express';

import type { AppConfig } from './config.js';
import { verifyAccessToken } from './auth.js';

export function requireAccessToken(config: AppConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authorization = req.header('authorization');
    if (!authorization || !authorization.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing bearer token' });
      return;
    }

    const token = authorization.slice('Bearer '.length).trim();
    if (token.length === 0) {
      res.status(401).json({ error: 'Missing bearer token' });
      return;
    }

    try {
      req.auth = verifyAccessToken(config, token);
      next();
    } catch {
      res.status(401).json({ error: 'Invalid or expired access token' });
    }
  };
}
