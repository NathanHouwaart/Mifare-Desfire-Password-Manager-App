import crypto from 'node:crypto';

import argon2 from 'argon2';
import jwt from 'jsonwebtoken';

import type { AppConfig } from './config.js';

export interface TokenClaims {
  sub: string; // user id
  did: string; // device id
  typ: 'access' | 'refresh';
  iat?: number;
  exp?: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 64 * 1024,
    timeCost: 3,
    parallelism: 1,
  });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function issueTokenPair(config: AppConfig, userId: string, deviceId: string): TokenPair {
  const accessToken = jwt.sign(
    { sub: userId, did: deviceId, typ: 'access' } satisfies TokenClaims,
    config.JWT_ACCESS_SECRET,
    { expiresIn: config.ACCESS_TOKEN_TTL }
  );

  const refreshToken = jwt.sign(
    { sub: userId, did: deviceId, typ: 'refresh' } satisfies TokenClaims,
    config.JWT_REFRESH_SECRET,
    { expiresIn: config.REFRESH_TOKEN_TTL }
  );

  return {
    accessToken,
    refreshToken,
    refreshExpiresAt: new Date(Date.now() + config.REFRESH_TOKEN_TTL_MS),
  };
}

function parseVerifiedToken(token: string, secret: string, expected: TokenClaims['typ']): TokenClaims {
  const decoded = jwt.verify(token, secret);
  if (typeof decoded !== 'object' || decoded === null) {
    throw new Error('Token payload is not an object');
  }

  const claims = decoded as Partial<TokenClaims>;
  if (claims.typ !== expected) {
    throw new Error(`Token type mismatch (expected ${expected})`);
  }
  if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
    throw new Error('Token missing subject');
  }
  if (typeof claims.did !== 'string' || claims.did.length === 0) {
    throw new Error('Token missing device id');
  }

  return claims as TokenClaims;
}

export function verifyAccessToken(config: AppConfig, token: string): TokenClaims {
  return parseVerifiedToken(token, config.JWT_ACCESS_SECRET, 'access');
}

export function verifyRefreshToken(config: AppConfig, token: string): TokenClaims {
  return parseVerifiedToken(token, config.JWT_REFRESH_SECRET, 'refresh');
}
