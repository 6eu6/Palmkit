/**
 * Stack Commands (frontend) — mirrors external-worker/src/stack-registry.ts.
 *
 * The frontend can't import from external-worker (separate packages), so
 * this file provides the same install/dev/port mapping for the E2B sandbox
 * preview. When a new stack is added to stack-registry.ts, add it here too.
 *
 * Used by use-worker-sandbox.ts to pass the RIGHT install/dev commands
 * to the E2B sandbox instead of hardcoding npm for everything.
 */

export interface StackCommands {
  install: string;
  dev: string;
  port: number;
}

/**
 * Map appType → {install, dev, port} for E2B sandbox preview.
 * appType comes from buildStatusStore (set by the worker's detectAppTypeFromFiles).
 */
const STACK_COMMANDS: Record<string, StackCommands> = {
  // JS stacks (default — npm)
  react: { install: 'npm install --no-audit --no-fund', dev: 'npm run dev -- --host 0.0.0.0 --port 5173', port: 5173 },
  vue: { install: 'npm install --no-audit --no-fund', dev: 'npm run dev -- --host 0.0.0.0 --port 5173', port: 5173 },
  nextjs: { install: 'npm install --no-audit --no-fund', dev: 'npm run dev -- --port 3000', port: 3000 },
  'node-express': { install: 'npm install --no-audit --no-fund', dev: 'node server.js', port: 3000 },

  // Static (no install, just serve)
  static: { install: '', dev: 'npx serve . --port 3000 --no-clipboard', port: 3000 },

  // Python (pip + python)
  python: { install: 'pip install -r requirements.txt', dev: 'python app.py', port: 5000 },

  // Flutter (flutter pub get + flutter run)
  flutter: { install: 'flutter pub get', dev: 'flutter run -d web-server --web-port 3000', port: 3000 },

  // React Native (no web preview — but keep entry for completeness)
  'react-native': { install: 'npm install --no-audit --no-fund', dev: 'npm run web', port: 3000 },
};

/**
 * Get install/dev/port for a given appType.
 * Falls back to React (npm) if unknown — same behavior as before the fix.
 */
export function getStackCommandsForAppType(appType: string): StackCommands {
  return STACK_COMMANDS[appType] ?? STACK_COMMANDS.react;
}
