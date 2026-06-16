import { cloudflareDevProxyVitePlugin as remixCloudflareDevProxy, vitePlugin as remixVitePlugin } from '@remix-run/dev';
import UnoCSS from 'unocss/vite';
import { defineConfig, type ViteDevServer } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { optimizeCssModules } from 'vite-plugin-optimize-css-modules';
import tsconfigPaths from 'vite-tsconfig-paths';
import * as dotenv from 'dotenv';

// Load environment variables from multiple files
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });
dotenv.config();

export default defineConfig((config) => {
  return {
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
    },
    build: {
      target: 'esnext',
    },
    plugins: [
      nodePolyfills({
        include: ['buffer', 'process', 'util', 'stream'],
        globals: {
          Buffer: true,
          process: true,
          global: true,
        },
        protocolImports: true,
        exclude: ['child_process', 'fs', 'path'],
      }),
      {
        name: 'buffer-polyfill',
        transform(code, id) {
          if (id.includes('env.mjs')) {
            return {
              code: `import { Buffer } from 'buffer';\n${code}`,
              map: null,
            };
          }

          return null;
        },
      },
      config.mode !== 'test' && remixCloudflareDevProxy(),
      remixVitePlugin({
        future: {
          v3_fetcherPersist: true,
          v3_relativeSplatPath: true,
          v3_throwAbortReason: true,
          v3_lazyRouteDiscovery: true,
        },
      }),
      UnoCSS(),
      tsconfigPaths(),
      e2bNodeStubPlugin(),
      chrome129IssuePlugin(),
      config.mode === 'production' && optimizeCssModules({ apply: 'build' }),
    ],
    envPrefix: [
      'VITE_',
      'OPENAI_LIKE_API_BASE_URL',
      'OPENAI_LIKE_API_MODELS',
      'OLLAMA_API_BASE_URL',
      'LMSTUDIO_API_BASE_URL',
      'TOGETHER_API_BASE_URL',
    ],
    css: {
      preprocessorOptions: {
        scss: {
          api: 'modern-compiler',
        },
      },
    },
    test: {
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/cypress/**',
        '**/.{idea,git,cache,output,temp}/**',
        '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
        '**/tests/preview/**', // Exclude preview tests that require Playwright
      ],
    },
  };
});

/**
 * Vite plugin that stubs Node.js builtins (`fs`, `path`) ONLY when imported
 * from the `e2b` SDK package.
 *
 * The e2b SDK (v2.29.1) bundles top-level `import fs from "node:fs"` and
 * `import path from "node:path"` for template/Dockerfile features we never use.
 * On Cloudflare Workers SSR build, Rollup can't resolve these — but we can't
 * add them to `nodePolyfills.include` because `api.git-info.ts` needs the REAL
 * `fs` module.
 *
 * This plugin intercepts `fs`/`path` imports specifically from the `e2b`
 * package and provides inert stubs, leaving all other imports untouched.
 */
function e2bNodeStubPlugin() {
  const FS_STUB = `
export const existsSync = () => false;
export const readFileSync = () => '';
export const statSync = () => ({ isFile: () => false, throwIfNoEntry: () => {} });
export const lstatSync = () => ({ isFile: () => false });
export const readlinkSync = () => '';
export const writeFileSync = () => {};
export const mkdirSync = () => {};
export const readdirSync = () => [];
export const createReadStream = () => ({ pipe: () => {} });
export default {
  existsSync, readFileSync, statSync, lstatSync, readlinkSync,
  writeFileSync, mkdirSync, readdirSync, createReadStream,
};
`.trimStart();

  const PATH_STUB = `
export const join = (...args: string[]) => args.join('/');
export const normalize = (p: string) => p;
export const sep = '/';
export const isAbsolute = (p: string) => p.startsWith('/');
export const resolve = (...args: string[]) => args.filter(Boolean).join('/');
export const dirname = (p: string) => p.split('/').slice(0, -1).join('/') || '.';
export const basename = (p: string) => p.split('/').pop() || p;
export const extname = (p: string) => {
  const base = p.split('/').pop() || '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot) : '';
};
export default { join, normalize, sep, isAbsolute, resolve, dirname, basename, extname };
`.trimStart();

  return {
    name: 'e2b-node-stub',
    enforce: 'pre' as const,
    resolveId(id: string, importer: string | undefined) {
      if (!importer) {
        return null;
      }

      const isE2b = importer.includes('node_modules/e2b') || importer.includes('node_modules/.pnpm') && importer.includes('e2b');

      if (!isE2b) {
        return null;
      }

      if (id === 'fs' || id === 'node:fs') {
        return '\0e2b-fs-stub';
      }

      if (id === 'path' || id === 'node:path') {
        return '\0e2b-path-stub';
      }

      return null;
    },
    load(id: string) {
      if (id === '\0e2b-fs-stub') {
        return FS_STUB;
      }

      if (id === '\0e2b-path-stub') {
        return PATH_STUB;
      }

      return null;
    },
  };
}

function chrome129IssuePlugin() {
  return {
    name: 'chrome129IssuePlugin',
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        const raw = req.headers['user-agent']?.match(/Chrom(e|ium)\/([0-9]+)\./);

        if (raw) {
          const version = parseInt(raw[2], 10);

          if (version === 129) {
            res.setHeader('content-type', 'text/html');
            res.end(
              '<body><h1>Please use Chrome Canary for testing.</h1><p>Chrome 129 has an issue with JavaScript modules & Vite local development, see <a href="https://github.com/stackblitz/bolt.new/issues/86#issuecomment-2395519258">for more information.</a></p><p><b>Note:</b> This only impacts <u>local development</u>. `pnpm run build` and `pnpm run start` will work fine in this browser.</p></body>',
            );

            return;
          }
        }

        next();
      });
    },
  };
}