/**
 * nativeHostRegistrar.ts
 *
 * Called on app startup. Writes the native messaging host manifest and
 * platform-specific registration so browser extensions can find the bridge.
 */

import { app } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

const HOST_NAME = 'com.securepass.bridge';
const FIREFOX_EXTENSION_ID = 'securepass@localhost';

const CHROME_REG_KEY = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`;
const FIREFOX_REG_KEY = `HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${HOST_NAME}`;

type UnixManifestTarget = {
  browser: string;
  manifestPath: string;
  isFirefox: boolean;
};

export type NativeHostRegistrationResult =
  | { ok: true; hostDir: string; registrationDir: string }
  | { ok: false; error: string; hostDir?: string };

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter((v): v is string => typeof v === 'string' && v.length > 0)));
}

function resolveBundledDirCandidates(dirName: string): string[] {
  const appPath = app.getAppPath();
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
    ?? path.resolve(appPath, '..');

  return uniqueStrings([
    path.join(resourcesPath, dirName),
    path.join(resourcesPath, 'app.asar.unpacked', dirName),
    path.resolve(appPath, dirName),
    path.resolve(appPath, '..', dirName),
    path.resolve(process.cwd(), dirName),
  ]);
}

function firstExistingDir(candidates: readonly string[]): string | null {
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        return candidate;
      }
    } catch {
      // Ignore unreadable candidates and continue.
    }
  }
  return null;
}

function getNativeHostDir(): { resolved: string | null; candidates: string[] } {
  const candidates = resolveBundledDirCandidates('native-host');
  return { resolved: firstExistingDir(candidates), candidates };
}

function getRegistrationDir(): string {
  return path.join(app.getPath('userData'), 'native-host');
}

function readExistingOrigins(pathsToRead: readonly string[]): string[] {
  const origins: string[] = [];
  for (const p of pathsToRead) {
    try {
      if (!fs.existsSync(p)) continue;
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8')) as { allowed_origins?: unknown };
      if (Array.isArray(parsed.allowed_origins)) {
        for (const origin of parsed.allowed_origins) {
          if (typeof origin === 'string' && origin.length > 0) {
            origins.push(origin);
          }
        }
      }
    } catch {
      // Ignore malformed files and continue.
    }
  }
  return uniqueStrings(origins);
}

function findNodeExecutable(): string {
  return process.platform === 'win32' ? findNodeOnWindows() : findNodeOnUnix();
}

function findNodeOnWindows(): string {
  const cached = process.env.SECUREPASS_NODE_EXE;
  if (cached && fs.existsSync(cached)) return cached;

  if (path.basename(process.execPath).toLowerCase() === 'node.exe' && fs.existsSync(process.execPath)) {
    return process.execPath;
  }

  try {
    const userPath = execSync(
      'powershell -NoProfile -Command "[System.Environment]::GetEnvironmentVariable(\'PATH\',\'User\')"',
      { encoding: 'utf8', timeout: 5000 }
    ).trim();

    const found = execSync('where.exe node', {
      encoding: 'utf8',
      timeout: 5000,
      env: { ...process.env, PATH: `${userPath};${process.env.PATH ?? ''}` },
    })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);

    if (found && fs.existsSync(found)) return found;
  } catch {
    // fall through
  }

  const candidates = [
    'C:\\nvm4w\\nodejs\\node.exe',
    'C:\\Program Files\\nodejs\\node.exe',
    path.join(process.env.APPDATA ?? '', 'nvm', 'nodejs', 'node.exe'),
    path.join(process.env.LOCALAPPDATA ?? '', 'fnm_multishells', 'node.exe'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return 'node';
}

function findNodeOnUnix(): string {
  const cached = process.env.SECUREPASS_NODE_EXE;
  if (cached && fs.existsSync(cached)) return cached;

  if (path.basename(process.execPath).startsWith('node') && fs.existsSync(process.execPath)) {
    return process.execPath;
  }

  try {
    const found = execSync('command -v node', { encoding: 'utf8', timeout: 5000 }).trim();
    if (found && fs.existsSync(found)) return found;
  } catch {
    // fall through
  }

  const candidates = ['/usr/local/bin/node', '/usr/bin/node', '/opt/homebrew/bin/node'];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return 'node';
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function writeWindowsLauncher(registrationDir: string, hostDir: string, nodeExe: string): string {
  const launcherPath = path.join(registrationDir, 'run-host.bat');
  const hostDirWin = hostDir.replace(/\//g, '\\');
  const nodeWin = nodeExe.replace(/\//g, '\\');

  const lines = [
    '@echo off',
    'setlocal',
    `set "HOST_DIR=${hostDirWin}"`,
    'if exist "%HOST_DIR%\\host.exe" (',
    '  "%HOST_DIR%\\host.exe" 2>> "%~dp0host-error.log"',
    ') else (',
    `  "${nodeWin}" "%HOST_DIR%\\host.js" 2>> "%~dp0host-error.log"`,
    ')',
  ];

  fs.writeFileSync(launcherPath, `${lines.join('\r\n')}\r\n`, 'utf8');
  return launcherPath;
}

function writeUnixLauncher(registrationDir: string, hostDir: string, nodeExe: string): string {
  const launcherPath = path.join(registrationDir, 'run-host.sh');
  const hostBinary = path.join(hostDir, 'host');
  const hostScript = path.join(hostDir, 'host.js');
  const errorLog = path.join(registrationDir, 'host-error.log');

  const lines = [
    '#!/usr/bin/env sh',
    'set -eu',
    `if [ -x ${shellQuote(hostBinary)} ]; then`,
    `  exec ${shellQuote(hostBinary)} 2>> ${shellQuote(errorLog)}`,
    'fi',
    `exec ${shellQuote(nodeExe)} ${shellQuote(hostScript)} 2>> ${shellQuote(errorLog)}`,
  ];

  fs.writeFileSync(launcherPath, `${lines.join('\n')}\n`, 'utf8');
  fs.chmodSync(launcherPath, 0o755);
  return launcherPath;
}

function writeLauncher(registrationDir: string, hostDir: string, nodeExe: string): string {
  return process.platform === 'win32'
    ? writeWindowsLauncher(registrationDir, hostDir, nodeExe)
    : writeUnixLauncher(registrationDir, hostDir, nodeExe);
}

function writeManifestJson(
  manifestPath: string,
  launcherPath: string,
  extra: Record<string, unknown>
): void {
  ensureDir(path.dirname(manifestPath));
  const manifest = {
    name: HOST_NAME,
    description: 'SecurePass NFC Password Manager bridge',
    path: process.platform === 'win32' ? launcherPath.replace(/\//g, '\\') : launcherPath,
    type: 'stdio',
    ...extra,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
}

function setRegistryKey(key: string, manifestPath: string): void {
  const escaped = manifestPath.replace(/\\/g, '\\\\');
  execSync(`reg add "${key}" /ve /t REG_SZ /d "${escaped}" /f`, {
    windowsHide: true,
    timeout: 5000,
  });
}

function getUnixManifestTargets(homeDir: string): UnixManifestTarget[] {
  if (process.platform === 'linux') {
    return [
      {
        browser: 'google-chrome',
        manifestPath: path.join(homeDir, '.config', 'google-chrome', 'NativeMessagingHosts', `${HOST_NAME}.json`),
        isFirefox: false,
      },
      {
        browser: 'chromium',
        manifestPath: path.join(homeDir, '.config', 'chromium', 'NativeMessagingHosts', `${HOST_NAME}.json`),
        isFirefox: false,
      },
      {
        browser: 'brave',
        manifestPath: path.join(homeDir, '.config', 'BraveSoftware', 'Brave-Browser', 'NativeMessagingHosts', `${HOST_NAME}.json`),
        isFirefox: false,
      },
      {
        browser: 'vivaldi',
        manifestPath: path.join(homeDir, '.config', 'vivaldi', 'NativeMessagingHosts', `${HOST_NAME}.json`),
        isFirefox: false,
      },
      {
        browser: 'firefox',
        manifestPath: path.join(homeDir, '.mozilla', 'native-messaging-hosts', `${HOST_NAME}.json`),
        isFirefox: true,
      },
    ];
  }

  if (process.platform === 'darwin') {
    return [
      {
        browser: 'google-chrome',
        manifestPath: path.join(homeDir, 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts', `${HOST_NAME}.json`),
        isFirefox: false,
      },
      {
        browser: 'chromium',
        manifestPath: path.join(homeDir, 'Library', 'Application Support', 'Chromium', 'NativeMessagingHosts', `${HOST_NAME}.json`),
        isFirefox: false,
      },
      {
        browser: 'brave',
        manifestPath: path.join(homeDir, 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser', 'NativeMessagingHosts', `${HOST_NAME}.json`),
        isFirefox: false,
      },
      {
        browser: 'vivaldi',
        manifestPath: path.join(homeDir, 'Library', 'Application Support', 'Vivaldi', 'NativeMessagingHosts', `${HOST_NAME}.json`),
        isFirefox: false,
      },
      {
        browser: 'firefox',
        manifestPath: path.join(homeDir, 'Library', 'Application Support', 'Mozilla', 'NativeMessagingHosts', `${HOST_NAME}.json`),
        isFirefox: true,
      },
    ];
  }

  return [];
}

export function registerNativeHost(
  log: (msg: string) => void = console.log
): NativeHostRegistrationResult {
  try {
    const { resolved: hostDir, candidates } = getNativeHostDir();
    if (!hostDir) {
      const msg = `[NativeHostRegistrar] native-host dir not found. Checked: ${candidates.join(', ')}`;
      log(msg);
      return { ok: false, error: msg };
    }

    const registrationDir = getRegistrationDir();
    ensureDir(registrationDir);

    const nodeExe = findNodeExecutable();
    const launcherPath = writeLauncher(registrationDir, hostDir, nodeExe);

    const registrationChromeManifest = path.join(registrationDir, `${HOST_NAME}.json`);
    const registrationFirefoxManifest = path.join(registrationDir, `${HOST_NAME}.firefox.json`);
    const repoChromeManifest = path.join(hostDir, `${HOST_NAME}.json`);

    const unixTargets = process.platform === 'win32' ? [] : getUnixManifestTargets(os.homedir());
    const existingChromeOrigins = readExistingOrigins([
      registrationChromeManifest,
      repoChromeManifest,
      ...unixTargets.filter((t) => !t.isFirefox).map((t) => t.manifestPath),
    ]);

    writeManifestJson(registrationChromeManifest, launcherPath, {
      allowed_origins: existingChromeOrigins,
    });
    writeManifestJson(registrationFirefoxManifest, launcherPath, {
      allowed_extensions: [FIREFOX_EXTENSION_ID],
    });

    if (process.platform === 'win32') {
      setRegistryKey(CHROME_REG_KEY, registrationChromeManifest);
      setRegistryKey(FIREFOX_REG_KEY, registrationFirefoxManifest);
      log(`[NativeHostRegistrar] registered on Windows. launcher=${launcherPath}`);
      return { ok: true, hostDir, registrationDir };
    }

    for (const target of unixTargets) {
      writeManifestJson(
        target.manifestPath,
        launcherPath,
        target.isFirefox
          ? { allowed_extensions: [FIREFOX_EXTENSION_ID] }
          : { allowed_origins: existingChromeOrigins }
      );
      log(`[NativeHostRegistrar] wrote ${target.browser} manifest: ${target.manifestPath}`);
    }

    if (existingChromeOrigins.length === 0) {
      log('[NativeHostRegistrar] warning: no Chrome/Chromium extension origin found in allowed_origins.');
    }

    log(`[NativeHostRegistrar] registered on ${process.platform}. launcher=${launcherPath} node=${nodeExe}`);
    return { ok: true, hostDir, registrationDir };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`[NativeHostRegistrar] registration failed: ${message}`);
    return { ok: false, error: message };
  }
}
