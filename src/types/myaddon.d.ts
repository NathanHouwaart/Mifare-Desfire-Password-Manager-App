declare module '../../build/myaddon.node' {
  export class MyObject {
    constructor(name: string);
    greet(str: string): string;
    add(a: number, b: number): number;
  }
}

declare module '*.node' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const value: any;
  export default value;
}
