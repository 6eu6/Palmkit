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

import type { FileOperation } from './generator';

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
      // Phase 3: E2BRunner for sandbox execution.
      // Phase 4: FlutterRunner (flutter build web), ExpoRunner (expo export -p web).
      return new StaticRunner();
    default:
      return new StaticRunner();
  }
}
