/**
 * Execution driver contract.
 *
 * A driver knows how to create an isolated sandbox, write files into it, start
 * the project (install + dev server) and expose the dev server so the proxy can
 * reach it. Implementations: docker (self-hosted, default) and e2b (managed).
 */

export interface StartOptions {
  /** Install command, e.g. "npm install" */
  install: string;
  /** Dev command, must bind 0.0.0.0, e.g. "npm run dev -- --host 0.0.0.0 --port 3000" */
  dev: string;
  /** Port the dev server listens on inside the sandbox */
  port: number;
}

export interface SandboxHandle {
  id: string;
  /** Host/URL the proxy should forward preview traffic to (e.g. "http://127.0.0.1:49832") */
  upstream: string;
  /** When the sandbox last received activity (updated by the server for idle reaping) */
  lastActiveAt: number;
}

export interface SandboxDriver {
  readonly name: string;
  create(): Promise<SandboxHandle>;
  writeFiles(id: string, files: Record<string, string>): Promise<void>;
  start(id: string, opts: StartOptions): Promise<{ upstream: string }>;
  logs(id: string): Promise<NodeJS.ReadableStream | string>;
  destroy(id: string): Promise<void>;
}
