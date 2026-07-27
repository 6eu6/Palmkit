/**
 * Project Spec — the small, honest core that replaced generator.ts.
 *
 * The old generator carried 1,100+ lines of legacy: keyword-regex intent
 * classification (planProject guessing appType from prompt words), JSON
 * one-shot generation prompts, and a parallel edit path — all superseded by
 * the Palmkit agent. What actually stayed alive was three types and ONE
 * real function: detecting the app type from the files the agent REALLY
 * produced (package.json deps + entry signatures), which drives the
 * preview runtime.
 *
 * Nothing here classifies the user's intent. The agent reads the request
 * and decides for itself whether it is a question, a build, or an edit.
 */

export interface ProjectSpec {
  appType: 'static' | 'react' | 'nextjs' | 'vue' | 'python' | 'flutter' | 'react-native';
  description: string;
  files: Array<{ path: string; purpose: string }>;
  designNotes: string;

  /** Optional: model's actual maxCompletionTokens (looked up from /api/models). */
  maxCompletionTokens?: number;
}

export interface FileOperation {
  op: 'write_file';
  path: string;
  content: string;
  mime_type?: string;
}

export interface GenerationResult {
  files: FileOperation[];
  complete: boolean;
  rawText: string;
  appType: ProjectSpec['appType'];
}

/**
 * The initial spec for a job. `appType` starts as a neutral scaffold hint
 * ('react' — the platform default) and is REPLACED after the build by
 * detectAppTypeFromFiles() on the agent's real output. No prompt-keyword
 * guessing.
 */
export function makeProjectSpec(prompt: string): ProjectSpec {
  return {
    appType: 'react',
    description: prompt.slice(0, 200),
    files: [],
    designNotes: '',
  };
}

/**
 * Detect the app type from the files the agent actually produced — the
 * generated package.json + entry files are the source of truth, and this
 * drives the correct preview runtime + build check.
 */
export function detectAppTypeFromFiles(files: Record<string, string>): ProjectSpec['appType'] | undefined {
  const paths = Object.keys(files);
  const has = (re: RegExp) => paths.some((p) => re.test(p));

  // Native / non-web stacks are unambiguous from a signature file.
  if (has(/(^|\/)pubspec\.yaml$/i) || has(/\.dart$/i)) {
    return 'flutter';
  }

  const pkgRaw = files['package.json'] ?? files['./package.json'];
  let deps: Record<string, string> = {};

  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw);
      deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    } catch {
      // malformed package.json — fall through to path-based checks
    }
  }

  const dep = (name: string) => name in deps;

  // Expo / React Native — check deps AND the app.json+App entry signature.
  if (dep('expo') || dep('react-native') || (has(/^app\.json$/i) && has(/^App\.(t|j)sx?$/i))) {
    return 'react-native';
  }

  if (dep('next')) {
    return 'nextjs';
  }

  if (dep('nuxt') || dep('vue') || has(/\.vue$/i)) {
    return 'vue';
  }

  if (dep('react') || dep('react-dom') || has(/^src\/.*\.(t|j)sx$/i)) {
    return 'react';
  }

  // Python: a server entry + requirements, no JS package.
  if (!pkgRaw && (has(/(^|\/)requirements\.txt$/i) || has(/^(app|main|server|run)\.py$/i))) {
    return 'python';
  }

  // Plain HTML/CSS/JS with no framework deps → static.
  if (has(/^index\.html$/i) && !pkgRaw) {
    return 'static';
  }

  if (has(/^index\.html$/i) && pkgRaw && !dep('react') && !dep('vue') && !dep('next')) {
    return 'static';
  }

  return undefined;
}
