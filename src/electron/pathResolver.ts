import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { isDev } from './utils.js';

function firstExistingFile(candidates: readonly string[]): string {
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // Ignore invalid candidates and continue.
    }
  }
  return candidates[0];
}

export function getPreloadPath(): string {
  const appPath = app.getAppPath();
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
    ?? path.resolve(appPath, '..');

  const candidates = isDev()
    ? [
        path.join(appPath, 'dist-electron', 'preload.cjs'),
        path.resolve(process.cwd(), 'dist-electron', 'preload.cjs'),
      ]
    : [
        path.join(resourcesPath, 'dist-electron', 'preload.cjs'),
        path.join(resourcesPath, 'app.asar.unpacked', 'dist-electron', 'preload.cjs'),
        path.join(appPath, '..', 'dist-electron', 'preload.cjs'),
      ];

  return firstExistingFile(candidates);
}

export function getUIPath(): string {
  const appPath = app.getAppPath();
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
    ?? path.resolve(appPath, '..');

  const candidates = isDev()
    ? [
        path.join(appPath, 'dist-react', 'index.html'),
        path.resolve(process.cwd(), 'dist-react', 'index.html'),
      ]
    : [
        path.join(resourcesPath, 'dist-react', 'index.html'),
        path.join(appPath, '..', 'dist-react', 'index.html'),
      ];

  return firstExistingFile(candidates);
}
