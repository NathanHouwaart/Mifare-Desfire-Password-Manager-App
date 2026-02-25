#!/usr/bin/env node
/**
 * Downloads the SiLabs CP210x Universal Windows Driver v11.5.0 and extracts
 * it to drivers/cp210x/ so the NSIS installer can run pnputil to install it.
 * Skips the download if silabser.inf is already present.
 */
import https from 'https';
import http  from 'http';
import fs    from 'fs';
import path  from 'path';
import { execSync }      from 'child_process';
import { fileURLToPath } from 'url';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const DRIVER_URL  = 'https://www.silabs.com/documents/public/software/CP210x_Universal_Windows_Driver.zip';
const DRIVER_DIR  = path.resolve(__dirname, '..', 'drivers', 'cp210x');
const ZIP_PATH    = path.resolve(__dirname, '..', 'drivers', 'cp210x.zip');
const MARKER_FILE = path.join(DRIVER_DIR, 'silabser.inf');

if (fs.existsSync(MARKER_FILE)) {
  console.log('[cp210x] Driver already present, skipping download.');
  process.exit(0);
}

fs.mkdirSync(DRIVER_DIR, { recursive: true });

function download(url, dest, cb, redirectCount = 0) {
  if (redirectCount > 10) return cb(new Error('Too many redirects'));
  const mod = url.startsWith('https') ? https : http;
  mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
    if ([301, 302, 307].includes(res.statusCode)) {
      return download(res.headers.location, dest, cb, redirectCount + 1);
    }
    if (res.statusCode !== 200) {
      return cb(new Error(`HTTP ${res.statusCode} fetching ${url}`));
    }
    const total = parseInt(res.headers['content-length'] || '0', 10);
    let received = 0;
    const file = fs.createWriteStream(dest);
    res.on('data', chunk => {
      received += chunk.length;
      if (total > 0) process.stdout.write(`\r[cp210x] Downloading... ${Math.floor(received/total*100)}%`);
    });
    res.pipe(file);
    file.on('finish', () => { process.stdout.write('\n'); file.close(cb); });
    file.on('error', cb);
  }).on('error', cb);
}

console.log('[cp210x] Downloading CP210x Universal Windows Driver v11.5.0...');
download(DRIVER_URL, ZIP_PATH, err => {
  if (err) { console.error('[cp210x] Download failed:', err.message); process.exit(1); }
  console.log('[cp210x] Extracting...');
  try {
    execSync(`powershell -NoProfile -Command "Expand-Archive -Force '${ZIP_PATH}' '${DRIVER_DIR}'"`, { stdio: 'inherit' });
    fs.unlinkSync(ZIP_PATH);
    if (!fs.existsSync(MARKER_FILE)) {
      console.error('[cp210x] silabser.inf not found after extraction. Contents:');
      fs.readdirSync(DRIVER_DIR).forEach(f => console.log(' ', f));
      process.exit(1);
    }
    console.log('[cp210x] Driver ready at:', DRIVER_DIR);
  } catch (e) { console.error('[cp210x] Extraction failed:', e.message); process.exit(1); }
});
