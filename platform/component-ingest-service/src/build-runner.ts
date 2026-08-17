/**
 * Build runners — where an ingested library's `npm install` + `ng build` executes.
 * Ingesting arbitrary code (install postinstall scripts + a build) is an RCE /
 * supply-chain risk, so the build step is pluggable:
 *
 *  - LocalBuildRunner  — runs in-process (dev / trusted operator only).
 *  - DockerBuildRunner — runs in an ephemeral, resource-capped, cap-dropped
 *                        container that can only touch the mounted workspace.
 *
 * Selected by `BUILD_SANDBOX=docker|local` (see config.ts).
 */
import { execFile } from 'node:child_process';

export interface BuildRunner {
  /** Install deps + `ng build <remoteName>` in `wsDir`; leaves `dist/<remoteName>`. */
  build(wsDir: string, remoteName: string, log: (l: string) => void): Promise<void>;
}

export interface DockerOptions {
  image: string;          // node build image, e.g. 'node:20-bookworm'
  memory: string;         // e.g. '4g'
  cpus: string;           // e.g. '2'
  pidsLimit: number;      // e.g. 512
  network: string;        // 'bridge' (npm reachable) or 'none' (pre-fetched only)
  readOnlyRoot: boolean;  // read-only rootfs + tmpfs /tmp
}

/** The command the container runs (install, then build). Kept simple + auditable. */
export const BUILD_SCRIPT = (remoteName: string): string =>
  `npm install --no-audit --no-fund --ignore-scripts=false && npx ng build ${shellQuote(remoteName)} --configuration production`;

/** Build the `docker run …` argv for a job (pure — unit-tested without Docker). */
export function dockerArgs(wsDir: string, remoteName: string, o: DockerOptions): string[] {
  const args = [
    'run', '--rm',
    '--network', o.network,
    '--memory', o.memory, '--cpus', o.cpus, '--pids-limit', String(o.pidsLimit),
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    // Keep all writes inside the mounted workspace (npm cache + HOME), so the
    // rootfs can be read-only.
    '-e', 'HOME=/work', '-e', 'npm_config_cache=/work/.npm',
    '-v', `${wsDir}:/work`, '-w', '/work',
  ];
  if (o.readOnlyRoot) args.push('--read-only', '--tmpfs', '/tmp:rw,exec');
  args.push(o.image, 'sh', '-lc', BUILD_SCRIPT(remoteName));
  return args;
}

export class DockerBuildRunner implements BuildRunner {
  constructor(private readonly opts: DockerOptions, private readonly timeoutMs = 15 * 60_000) {}
  async build(wsDir: string, remoteName: string, log: (l: string) => void): Promise<void> {
    await run('docker', dockerArgs(wsDir, remoteName, this.opts), undefined, this.timeoutMs, log);
  }
}

export class LocalBuildRunner implements BuildRunner {
  constructor(private readonly timeoutMs = 15 * 60_000) {}
  async build(wsDir: string, remoteName: string, log: (l: string) => void): Promise<void> {
    log('WARNING: local (unsandboxed) build — trusted operator only. Set BUILD_SANDBOX=docker to isolate.');
    await run('npm', ['install', '--no-audit', '--no-fund'], wsDir, this.timeoutMs, log);
    await run('npx', ['ng', 'build', remoteName, '--configuration', 'production'], wsDir, this.timeoutMs, log);
  }
}

function run(cmd: string, args: string[], cwd: string | undefined, timeout: number, log: (l: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    log(`$ ${cmd} ${args.join(' ')}`);
    const child = execFile(cmd, args, { cwd, maxBuffer: 64 * 1024 * 1024, timeout });
    child.stdout?.on('data', (d) => log(String(d).trimEnd()));
    child.stderr?.on('data', (d) => log(String(d).trimEnd()));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

function shellQuote(s: string): string { return /^[a-zA-Z0-9._-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`; }
