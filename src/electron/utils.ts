import { app } from 'electron';

export function isDev(): boolean {
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv === 'development') return true;
  if (nodeEnv === 'production') return false;
  // Protocol launches may not carry NODE_ENV; app.isPackaged is stable.
  return !app.isPackaged;
}
