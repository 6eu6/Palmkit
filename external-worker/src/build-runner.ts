/**
 * BuildRunner — abstraction layer for different execution environments.
 *
 * Phase 2: StaticRunner (generate + serve static files, no sandbox)
 * Phase 3: E2BRunner (full sandbox — React build, Python, Node backend)
 * Future:  WebContainerRunner, FlyRunner
 *
 * The job-processor calls runner.prepare() → runner.build() → runner.snapshot()
 * without knowing which environment is running underneath.
 */

import type { FileOperation } from './project-spec';

export interface RuntimeSession {
  sessionId: string;
  runtimeMode: 'static' | 'e2b' | 'webcontainer';
}

export interface BuildResult {
  success: boolean;
  outputFiles: FileOperation[];
  buildLog?: string;
  error?: string;
}

export interface PreviewEndpoint {
  url: string;
  type: 'blob' | 'sandbox' | 'r2';
}

export interface SnapshotRef {
  snapshotId: string;
  fileCount: number;
  storagePrefix: string;
}

export interface BuildRunner {
  runtimeMode: RuntimeSession['runtimeMode'];
  prepare(files: FileOperation[]): Promise<RuntimeSession>;
  build(session: RuntimeSession): Promise<BuildResult>;
  snapshot(session: RuntimeSession, files: FileOperation[]): Promise<SnapshotRef>;
  stop(session: RuntimeSession): Promise<void>;
}

/**
 * StaticRunner — no sandbox, no npm install.
 *
 * Used for HTML/CSS/JS projects. Files are the output as-is.
 * Preview is served via R2 + blob URL in the browser.
 */
export class StaticRunner implements BuildRunner {
  readonly runtimeMode = 'static' as const;

  async prepare(files: FileOperation[]): Promise<RuntimeSession> {
    return { sessionId: `static-${Date.now()}`, runtimeMode: 'static' };
  }

  async build(session: RuntimeSession): Promise<BuildResult> {
    return { success: true, outputFiles: [] };
  }

  async snapshot(session: RuntimeSession, files: FileOperation[]): Promise<SnapshotRef> {
    return {
      snapshotId: session.sessionId,
      fileCount: files.length,
      storagePrefix: `snapshots/${session.sessionId}`,
    };
  }

  async stop(_session: RuntimeSession): Promise<void> {}
}

/**
 * Choose the correct runner based on the app type.
 *
 * static → StaticRunner (blob URL preview, no sandbox needed)
 * react/nextjs/vue/python/flutter/react-native → E2BRunner (sandbox with npm run dev)
 *
 * NOTE: E2BRunner is not yet fully implemented in the worker. For now,
 * these types use StaticRunner but with runtimeMode='e2b' so the frontend
 * knows to launch an E2B sandbox for preview. The actual build (npm install,
 * npm run dev) happens in the E2B sandbox when the user clicks "Launch Preview".
 */
export function createRunner(
  appType: 'static' | 'react' | 'nextjs' | 'vue' | 'python' | 'flutter' | 'react-native',
): BuildRunner {
  switch (appType) {
    case 'static':
      return new StaticRunner();
    case 'react':
    case 'nextjs':
    case 'vue':
    case 'python':
    case 'flutter':
    case 'react-native':
      // These need E2B sandbox for preview (npm run dev / python app.py / etc.)
      // The runner itself doesn't build — it just flags the runtimeMode.
      return new E2BFlagRunner();
    default:
      return new StaticRunner();
  }
}

/**
 * E2BFlagRunner — flags the project as needing E2B sandbox for preview.
 *
 * Unlike StaticRunner, this sets runtimeMode='e2b' so the frontend knows
 * to show a "Launch Preview" button and start an E2B sandbox when clicked.
 * The actual build (npm install, npm run dev) happens in the E2B sandbox.
 */
class E2BFlagRunner implements BuildRunner {
  readonly runtimeMode = 'e2b' as const;

  async prepare(files: FileOperation[]): Promise<RuntimeSession> {
    return { sessionId: `e2b-${Date.now()}`, runtimeMode: 'e2b' };
  }

  async build(session: RuntimeSession): Promise<BuildResult> {
    // No build step — the E2B sandbox will handle npm install + npm run dev
    // when the user clicks "Launch Preview" in the frontend.
    return { success: true, outputFiles: [] };
  }

  async snapshot(session: RuntimeSession, files: FileOperation[]): Promise<SnapshotRef> {
    return {
      snapshotId: session.sessionId,
      fileCount: files.length,
      storagePrefix: `snapshots/${session.sessionId}`,
    };
  }

  async stop(_session: RuntimeSession): Promise<void> {}
}
