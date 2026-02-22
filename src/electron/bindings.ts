import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// common places cmake-js / node-gyp put the .node file
const candidates = [
  path.resolve(process.cwd(), 'build', 'Release', 'myaddon.node'),
  path.resolve(process.cwd(), 'build', 'myaddon.node'),
  path.resolve(__dirname, '..', '..', 'build', 'Release', 'myaddon.node'),
  path.resolve(__dirname, '..', '..', 'build', 'myaddon.node')
];

const addonPath = candidates.find(p => fs.existsSync(p));

if (!addonPath) {
  throw new Error(
    'myaddon.node not found. Run `npm run build:addon:rebuild` and confirm output location. Checked: ' +
    candidates.join(';')
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const addon: any = require(addonPath);

export interface MyObject {
    greet(str: string): string;
    add(a: number, b: number): number;
}

export const MyObject: {
    new(name: string): MyObject;
} = addon.MyObject;
