import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In a packaged app, electron-builder copies extraResources next to the asar so
// process.resourcesPath points to the folder containing build/Release/myaddon.node.
// In dev, process.resourcesPath is undefined, so we fall back to the repo root.
const resourcesPath: string = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  ?? path.resolve(__dirname, '..', '..');

const candidates = [
  path.join(resourcesPath, 'build', 'Release', 'myaddon.node'),
  path.join(resourcesPath, 'build', 'myaddon.node'),
  // Stable dev fallback based on this file's location (independent of process.cwd()).
  path.resolve(__dirname, '..', '..', 'build', 'Release', 'myaddon.node'),
  path.resolve(__dirname, '..', '..', 'build', 'myaddon.node'),
  // Legacy dev fallbacks
  path.resolve(process.cwd(), 'build', 'Release', 'myaddon.node'),
  path.resolve(process.cwd(), 'build', 'myaddon.node'),
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

export interface MyLibraryBinding {
    greet(guestName: string): string;
    add(a: number, b: number): number;
}

export const MyLibraryBinding: {
    new(name: string): MyLibraryBinding;
} = addon.MyLibraryBinding;

export interface NfcCppBinding {
    connect(port: string): Promise<string>;
    disconnect(): Promise<boolean>;
    setLogCallback(callback?: (level: string, message: string) => void): void;
    getFirmwareVersion(): Promise<string>;
    runSelfTests(onProgress?: (row: SelfTestResultDto) => void): Promise<SelfTestReportDto>;
    getCardVersion(): Promise<CardVersionInfoDto>;

    // Password vault card operations
    /** Returns null when no card is present; rejects on hardware errors. */
    peekCardUid(): Promise<string | null>;
    /** True if App AID 505700 is present on the card. */
    isCardInitialised(): Promise<boolean>;
    /** Single-scan probe: one InListPassiveTarget returning uid + isInitialised. */
    probeCard(): Promise<{ uid: string | null; isInitialised: boolean }>;
    /** Runs the 11-step secure init sequence. */
    initCard(opts: CardInitOptsDto): Promise<boolean>;
    /** Authenticates with readKey and returns the 16-byte card secret as a Buffer. */
    readCardSecret(readKey: number[]): Promise<Buffer>;
    /** Returns free EEPROM bytes remaining on the PICC. */
    cardFreeMemory(): Promise<number>;
    /** Runs FormatPICC — destroys all applications and files. */
    formatCard(): Promise<boolean>;
    /** Returns AIDs as uppercase hex strings, e.g. ["505700"]. */
    getCardApplicationIds(): Promise<string[]>;
}

/** Options passed to initCard — all keys are raw AES-128 byte arrays. */
export interface CardInitOptsDto {
    /** 3-byte AID, e.g. [0x50, 0x57, 0x00] */
    aid: number[];
    /** 16-byte AES-128 app master key */
    appMasterKey: number[];
    /** 16-byte AES-128 read key (key slot 1) */
    readKey: number[];
    /** 16 random bytes written as the card secret */
    cardSecret: number[];
}

export const NfcCppBinding: {
    new(): NfcCppBinding;
} = addon.NfcCppBinding;
