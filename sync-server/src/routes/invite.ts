import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';

interface InviteRouteDeps {
  publicBaseUrl?: string;
}

const usernameSchema = z.preprocess(
  (value) => (typeof value === 'string' ? value : undefined),
  z.string().trim().min(3).max(64).regex(/^[A-Za-z0-9_.-]+$/).optional()
);

const inviteQuerySchema = z.object({
  username: usernameSchema,
});

function normalizeServerUrl(raw: string): string {
  const parsed = new URL(raw.trim());
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Invite server URL must use http or https');
  }
  const trimmedPath = parsed.pathname.endsWith('/') && parsed.pathname !== '/'
    ? parsed.pathname.slice(0, -1)
    : parsed.pathname;
  parsed.pathname = trimmedPath;
  return parsed.toString().replace(/\/$/, '');
}

function inferServerUrlFromRequest(req: Request): string {
  const host = req.get('host');
  if (!host) {
    throw new Error('Missing Host header');
  }
  const forwardedProto = req.get('x-forwarded-proto');
  const protocol = forwardedProto?.split(',')[0]?.trim() || req.protocol || 'http';
  return normalizeServerUrl(`${protocol}://${host}`);
}

function buildInviteUrl(serverUrl: string, username?: string): string {
  const invite = new URL('securepass://invite');
  invite.searchParams.set('server', serverUrl);
  if (username) invite.searchParams.set('username', username);
  return invite.toString();
}

export function registerInviteRoutes({ publicBaseUrl }: InviteRouteDeps): Router {
  const router = Router();
  const fixedBaseUrl = publicBaseUrl ? normalizeServerUrl(publicBaseUrl) : null;

  const buildPayload = (req: Request, username?: string) => {
    const serverUrl = fixedBaseUrl ?? inferServerUrlFromRequest(req);
    const inviteUrl = buildInviteUrl(serverUrl, username);
    return {
      inviteUrl,
      serverUrl,
      ...(username ? { username } : {}),
    };
  };

  router.get('/link', (req, res) => {
    const parsed = inviteQuerySchema.safeParse({ username: req.query.username });
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    try {
      res.status(200).json(buildPayload(req, parsed.data.username));
    } catch (error) {
      console.error('[invite/link] failed', error);
      res.status(500).json({ error: 'Failed to generate invite link' });
    }
  });

  router.get('/open', (req, res) => {
    const parsed = inviteQuerySchema.safeParse({ username: req.query.username });
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    try {
      const payload = buildPayload(req, parsed.data.username);
      res.redirect(payload.inviteUrl);
    } catch (error) {
      console.error('[invite/open] failed', error);
      res.status(500).json({ error: 'Failed to generate invite redirect' });
    }
  });

  return router;
}
