declare module '../../build/myaddon.node' {
  export class MyLibraryBinding {
    constructor(name: string);
    greet(str: string): string;
    add(a: number, b: number): number;
  }
  export class NfcCppBinding {
    constructor();
    connect(port: string): Promise<string>;
    disconnect(): Promise<boolean>;
    setLogCallback(callback?: (level: string, message: string) => void): void;
  }
}

declare module '*.node' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const value: any;
  export default value;
}
