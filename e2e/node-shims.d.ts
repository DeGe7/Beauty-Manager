declare const process: {
  env: Record<string, string | undefined>;
};

declare function setInterval(callback: () => void, delay: number): unknown;

declare module 'node:fs' {
  export function chmodSync(path: string, mode: number): void;
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function readdirSync(path: string): string[];
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function rmSync(path: string, options?: { force?: boolean }): void;
  export function writeFileSync(path: string, data: string, options?: { encoding?: string; mode?: number }): void;
}

declare module 'node:path' {
  export function dirname(path: string): string;
  export function join(...parts: string[]): string;
  export function resolve(...parts: string[]): string;
}

declare module 'node:crypto' {
  interface RandomBytes {
    toString(encoding: 'base64url' | 'hex'): string;
  }
  export function createHash(algorithm: string): {
    update(value: string): { digest(encoding: 'hex'): string };
  };
  export function randomBytes(size: number): RandomBytes;
}

declare module 'node:buffer' {
  export interface Buffer extends Uint8Array {}
  export const Buffer: {
    from(value: string, encoding: 'base64'): Buffer;
  };
}

declare module 'node:url' {
  export class URL {
    constructor(url: string);
    pathname: string;
  }
}

interface Response {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

declare function fetch(
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
): Promise<Response>;