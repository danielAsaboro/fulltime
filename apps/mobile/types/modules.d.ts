declare module "*.bundle.mjs" {
  const source: Uint8Array;
  export default source;
}

declare module "b4a" {
  interface B4A {
    alloc(size: number, fill?: number): Uint8Array;
    byteLength(value: string, encoding?: string): number;
    from(value: string | Uint8Array | ArrayBuffer, encoding?: string): Uint8Array;
    isBuffer(value: unknown): value is Uint8Array;
    toString(value: Uint8Array, encoding?: string): string;
  }
  const b4a: B4A;
  export default b4a;
}

declare module "framed-stream" {
  import type { Duplex } from "streamx";
  export default class FramedStream extends Duplex {
    constructor(stream: Duplex, options?: { bits?: 8 | 16 | 24 | 32 });
  }
}
