/**
 * Stack Registry — the single source of truth for ALL stack behavior.
 *
 * RADICAL FIX: replaces 5 separate hardcoded layers that each enforced
 * the npm+vite mental model independently:
 *   1. project-spec.ts appType string union (7 values, 3 broken)
 *   2. build-checker.ts BUILD_CHECK_TYPES (3 of 7 supported)
 *   3. project-analyzer.ts (different enum, no flutter/RN)
 *   4. use-worker-sandbox.ts (hardcodes npm install/dev for ALL)
 *   5. api.sb.ts defaults (npm install + npm run dev)
 *
 * Now every stack has ONE descriptor with install/build/run commands,
 * E2B template, preview port, and verification. All 5 layers read from
 * this registry instead of hardcoding npm.
 *
 * Adding a new stack = adding ONE entry here. No other file changes.
 */

export type StackId =
  | 'react'
  | 'vue'
  | 'nextjs'
  | 'static'
  | 'python-flask'
  | 'python-fastapi'
  | 'node-express'
  | 'flutter-web'
  | 'phaser'
  | 'threejs';

export interface StackDescriptor {
  /** Unique identifier */
  id: StackId;

  /** Human-readable name */
  name: string;

  /** The appType value from project-spec.ts (for backward compat) */
  appType: string;

  /** How to install dependencies in E2B sandbox */
  install: string;

  /** How to start the dev server in E2B sandbox */
  dev: string;

  /** How to build for production (empty = no build step) */
  build: string;

  /** Port the dev server listens on */
  port: number;

  /** How to verify the build succeeded (empty = skip verification) */
  verify: string;

  /** E2B template name (empty = use default node-22 template) */
  e2bTemplate: string;

  /** File signatures that identify this stack (for detection) */
  detect: {
    /** Files that must exist (regex patterns) */
    files?: RegExp[];
    /** Dependencies that must be in package.json (for JS stacks) */
    deps?: string[];
  };
}

/**
 * The registry — ALL stacks defined here. To add a new stack, add ONE entry.
 */
export const STACK_REGISTRY: Record<StackId, StackDescriptor> = {
  react: {
    id: 'react',
    name: 'React + Vite',
    appType: 'react',
    install: 'npm install --no-audit --no-fund',
    dev: 'npm run dev -- --host 0.0.0.0 --port 5173',
    build: 'npm run build',
    port: 5173,
    verify: 'npm run build',
    e2bTemplate: '',
    detect: {
      deps: ['react', 'react-dom'],
      files: [/^src\/.*\.(t|j)sx$/i],
    },
  },

  vue: {
    id: 'vue',
    name: 'Vue + Vite',
    appType: 'vue',
    install: 'npm install --no-audit --no-fund',
    dev: 'npm run dev -- --host 0.0.0.0 --port 5173',
    build: 'npm run build',
    port: 5173,
    verify: 'npm run build',
    e2bTemplate: '',
    detect: {
      deps: ['vue'],
      files: [/\.vue$/i],
    },
  },

  nextjs: {
    id: 'nextjs',
    name: 'Next.js',
    appType: 'nextjs',
    install: 'npm install --no-audit --no-fund',
    dev: 'npm run dev -- --port 3000',
    build: 'npm run build',
    port: 3000,
    verify: 'npm run build',
    e2bTemplate: '',
    detect: {
      deps: ['next'],
    },
  },

  static: {
    id: 'static',
    name: 'Static HTML/CSS/JS',
    appType: 'static',
    install: '',
    dev: 'npx serve . --port 3000 --no-clipboard',
    build: '',
    port: 3000,
    verify: '',
    e2bTemplate: '',
    detect: {
      files: [/^index\.html$/i],
    },
  },

  'python-flask': {
    id: 'python-flask',
    name: 'Python + Flask',
    appType: 'python',
    install: 'pip install -r requirements.txt',
    dev: 'python app.py',
    build: '',
    port: 5000,
    verify: 'python -c "import app"',
    e2bTemplate: 'palmkit-python-3.12',
    detect: {
      files: [/^app\.py$/i, /(^|\/)requirements\.txt$/i],
    },
  },

  'python-fastapi': {
    id: 'python-fastapi',
    name: 'Python + FastAPI',
    appType: 'python',
    install: 'pip install -r requirements.txt',
    dev: 'uvicorn main:app --host 0.0.0.0 --port 8000',
    build: '',
    port: 8000,
    verify: 'python -c "import main"',
    e2bTemplate: 'palmkit-python-3.12',
    detect: {
      files: [/^main\.py$/i, /(^|\/)requirements\.txt$/i],
    },
  },

  'node-express': {
    id: 'node-express',
    name: 'Node.js + Express',
    appType: 'react',
    install: 'npm install --no-audit --no-fund',
    dev: 'node server.js',
    build: '',
    port: 3000,
    verify: 'node -c server.js',
    e2bTemplate: '',
    detect: {
      deps: ['express'],
      files: [/^server\.(t|j)s$/i],
    },
  },

  'flutter-web': {
    id: 'flutter-web',
    name: 'Flutter Web',
    appType: 'flutter',
    install: 'flutter pub get',
    dev: 'flutter run -d web-server --web-port 3000',
    build: 'flutter build web',
    port: 3000,
    verify: 'flutter analyze',
    e2bTemplate: 'palmkit-flutter-web',
    detect: {
      files: [/^pubspec\.yaml$/i],
    },
  },

  phaser: {
    id: 'phaser',
    name: 'Phaser 3 (Game)',
    appType: 'static',
    install: '',
    dev: 'npx serve . --port 3000 --no-clipboard',
    build: '',
    port: 3000,
    verify: '',
    e2bTemplate: '',
    detect: {
      files: [/phaser/i, /^index\.html$/i],
    },
  },

  threejs: {
    id: 'threejs',
    name: 'Three.js (3D)',
    appType: 'static',
    install: '',
    dev: 'npx serve . --port 3000 --no-clipboard',
    build: '',
    port: 3000,
    verify: '',
    e2bTemplate: '',
    detect: {
      files: [/three/i, /^index\.html$/i],
    },
  },
};

/**
 * Detect the stack from the generated files.
 * Replaces detectAppTypeFromFiles() — returns a StackId instead of appType string.
 */
export function detectStackFromFiles(files: Record<string, string>): StackId | undefined {
  const paths = Object.keys(files);
  const has = (re: RegExp) => paths.some((p) => re.test(p));

  // Check Flutter first (unambiguous)
  if (has(/(^|\/)pubspec\.yaml$/i) || has(/\.dart$/i)) {
    return 'flutter-web';
  }

  // Parse package.json deps if present
  const pkgRaw = files['package.json'] ?? files['./package.json'];
  let deps: Record<string, string> = {};

  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw);
      deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    } catch {
      // malformed — fall through
    }
  }

  const dep = (name: string) => name in deps;

  // JS frameworks (check in specificity order)
  if (dep('next')) return 'nextjs';
  if (dep('nuxt') || dep('vue') || has(/\.vue$/i)) return 'vue';
  if (dep('express') && has(/^server\.(t|j)s$/i)) return 'node-express';
  if (dep('react') || dep('react-dom') || has(/^src\/.*\.(t|j)sx$/i)) return 'react';

  // Python (check for Flask vs FastAPI)
  if (!pkgRaw && (has(/(^|\/)requirements\.txt$/i))) {
    if (has(/^app\.py$/i)) return 'python-flask';
    if (has(/^main\.py$/i)) return 'python-fastapi';
    return 'python-flask'; // default to Flask
  }

  // Games (check for phaser/three in file names or content)
  if (has(/phaser/i) && has(/^index\.html$/i)) return 'phaser';
  if (has(/three/i) && has(/^index\.html$/i)) return 'threejs';

  // Plain HTML/CSS/JS → static
  if (has(/^index\.html$/i)) return 'static';

  return undefined;
}

/**
 * Get a stack descriptor by StackId.
 * Falls back to 'react' (the platform default) if not found.
 */
export function getStack(stackId: StackId | string | undefined): StackDescriptor {
  if (stackId && stackId in STACK_REGISTRY) {
    return STACK_REGISTRY[stackId as StackId];
  }

  // Fallback: try matching by appType (backward compat with old jobs)
  for (const stack of Object.values(STACK_REGISTRY)) {
    if (stack.appType === stackId) {
      return stack;
    }
  }

  return STACK_REGISTRY.react; // ultimate fallback
}

/**
 * Get the install + dev commands for a given appType.
 * Used by use-worker-sandbox.ts to pass the RIGHT commands to E2B
 * instead of hardcoding npm for everything.
 */
export function getStackCommands(appType: string): { install: string; dev: string; port: number } {
  const stack = getStack(appType);

  return {
    install: stack.install,
    dev: stack.dev,
    port: stack.port,
  };
}
