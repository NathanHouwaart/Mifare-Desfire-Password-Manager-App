import type { TokenClaims } from '../auth.js';

declare global {
  namespace Express {
    interface Request {
      auth?: TokenClaims;
    }
  }
}

export {};
