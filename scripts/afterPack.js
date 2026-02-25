/**
 * afterPack hook — runs after electron-builder has assembled the app
 * bundle but before NSIS packages it into an installer.
 *
 * Embeds favicon.ico into the SecurePass.exe resource table using the
 * standalone rcedit-x64.exe binary so that Windows Explorer and the
 * taskbar show the correct icon.  This avoids the need for winCodeSign
 * (which cannot be extracted on Windows without Developer Mode / admin).
 */
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs   from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default async function afterPack(context) {
  // Only runs for Windows builds
  if (context.electronPlatformName !== 'win32') return;

  const rcedit  = path.resolve(__dirname, '..', 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe');
  const exePath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const icon    = path.resolve(__dirname, '..', 'assets', 'favicon.ico');

  if (!fs.existsSync(rcedit)) {
    console.warn('[afterPack] rcedit-x64.exe not found — icon will not be embedded.');
    return;
  }
  if (!fs.existsSync(exePath)) {
    console.warn('[afterPack] exe not found at', exePath);
    return;
  }
  if (!fs.existsSync(icon)) {
    console.warn('[afterPack] favicon.ico not found at', icon);
    return;
  }

  console.log('[afterPack] Embedding icon into', path.basename(exePath));
  try {
    execFileSync(rcedit, [exePath, '--set-icon', icon], { stdio: 'inherit' });
    console.log('[afterPack] Icon embedded successfully.');
  } catch (err) {
    console.error('[afterPack] rcedit failed:', err.message);
    // Non-fatal — app still works without an embedded icon
  }
}
