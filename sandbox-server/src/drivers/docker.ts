/**
 * Docker driver — self-hosted, free, sustainable.
 *
 * One container per sandbox session, hardened and resource-capped. The
 * project's dev server is published to an ephemeral host port; the server's
 * preview proxy forwards `/preview/:id/*` to it.
 */
import Docker from 'dockerode';
import { Readable } from 'node:stream';
import type { SandboxDriver, SandboxHandle, StartOptions } from './types.js';

const docker = new Docker(); // talks to /var/run/docker.sock

const IMAGE = process.env.SANDBOX_IMAGE || 'palmkit-sandbox';
const MEMORY = process.env.SANDBOX_MEMORY || '1g';
const CPUS = parseFloat(process.env.SANDBOX_CPUS || '1.0');

function parseMemory(v: string): number {
  const m = /^(\d+)([gm])$/i.exec(v.trim());

  if (!m) {
    return 1024 * 1024 * 1024;
  }

  const n = parseInt(m[1], 10);

  return m[2].toLowerCase() === 'g' ? n * 1024 ** 3 : n * 1024 ** 2;
}

const containers = new Map<string, Docker.Container>();

export const dockerDriver: SandboxDriver = {
  name: 'docker',

  async create(): Promise<SandboxHandle> {
    const id = `pf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    const container = await docker.createContainer({
      name: id,
      Image: IMAGE,
      // Keep the container alive; we exec commands into it.
      Cmd: ['sleep', 'infinity'],
      WorkingDir: '/home/project',
      User: 'sandbox',
      ExposedPorts: { '3000/tcp': {} },
      HostConfig: {
        Memory: parseMemory(MEMORY),
        NanoCpus: Math.round(CPUS * 1e9),
        PidsLimit: 512,
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges'],
        // publish 3000 to a random host port
        PortBindings: { '3000/tcp': [{ HostPort: '0' }] },
        // allow npm egress but no access to host services
        NetworkMode: 'bridge',
        ReadonlyRootfs: false,
      },
    });

    await container.start();
    containers.set(id, container);

    return { id, upstream: '', lastActiveAt: Date.now() };
  },

  async writeFiles(id, files) {
    const container = containers.get(id);

    if (!container) {
      throw new Error(`sandbox ${id} not found`);
    }

    // Build a tar archive in-memory and put it into /home/project.
    const pack = (await import('tar-stream')).pack();

    for (const [path, contents] of Object.entries(files)) {
      pack.entry({ name: path.replace(/^\/+/, '') }, contents);
    }
    pack.finalize();

    await container.putArchive(pack as unknown as Readable, { path: '/home/project' });
  },

  async start(id, opts: StartOptions) {
    const container = containers.get(id);

    if (!container) {
      throw new Error(`sandbox ${id} not found`);
    }

    // Run install (blocking) then dev server (detached) inside the container.
    const sh = `cd /home/project && ${opts.install} && (${opts.dev} > /tmp/dev.log 2>&1 &)`;
    const exec = await container.exec({
      Cmd: ['bash', '-lc', sh],
      AttachStdout: true,
      AttachStderr: true,
    });
    await exec.start({});

    // Resolve the published host port for 3000.
    const info = await container.inspect();
    const binding = info.NetworkSettings.Ports?.['3000/tcp']?.[0];

    if (!binding) {
      throw new Error('dev server port not published');
    }

    const upstream = `http://127.0.0.1:${binding.HostPort}`;

    return { upstream };
  },

  async logs(id) {
    const container = containers.get(id);

    if (!container) {
      return 'sandbox not found';
    }

    const exec = await container.exec({
      Cmd: ['bash', '-lc', 'cat /tmp/dev.log 2>/dev/null || echo "(no logs yet)"'],
      AttachStdout: true,
      AttachStderr: true,
    });
    const stream = await exec.start({});

    return stream as unknown as NodeJS.ReadableStream;
  },

  async destroy(id) {
    const container = containers.get(id);

    if (!container) {
      return;
    }

    containers.delete(id);

    try {
      await container.remove({ force: true });
    } catch {
      // already gone
    }
  },
};
