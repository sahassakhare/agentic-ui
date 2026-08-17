/**
 * The ingest pipeline: unpack → introspect → scaffold → npm install → ng build →
 * serve → register. The deterministic steps (introspect/generate/scaffold) are
 * unit-tested; the heavy steps (`npm install`, `ng build`) shell out. Runs async;
 * status is reported through the JobStore.
 */
import { execFile } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { introspectLibrary } from './introspect.js';
import { generateCapabilityTs, componentCatalogBody, type RemoteMeta } from './generate.js';
import { scaffoldRemote } from './scaffold.js';
import { registerComponents, type CatalogTarget } from './catalog.js';
import type { BuildRunner } from './build-runner.js';
import type { JobStore } from './jobs.js';
import type { RegistryStore } from './registry.js';

export interface IngestInput {
  /** An npm spec (`@progress/kendo-angular-buttons@1.2.3`) OR a path to a `.tgz`/`.zip`. */
  readonly npm?: string;
  readonly archivePath?: string;
}

export interface PipelineCtx {
  readonly workDir: string;
  readonly artifactDir: string;
  readonly publicUrl: string;
  readonly catalog: CatalogTarget;
  readonly jobs: JobStore;
  readonly registry: RegistryStore;
  /** Where install + ng build run (local in-process, or a sandboxed container). */
  readonly builder: BuildRunner;
}

export async function runIngest(jobId: string, input: IngestInput, ctx: PipelineCtx): Promise<void> {
  const { jobs } = ctx;
  const job = jobs.get(jobId)!;
  const remoteName = job.remoteName;
  const jobDir = join(ctx.workDir, remoteName);
  const log = (l: string) => { jobs.log(jobId, l); };
  const fail = (msg: string) => { jobs.update(jobId, { phase: 'failed', error: msg }); log(`ERROR: ${msg}`); };

  try {
    rmSync(jobDir, { recursive: true, force: true });
    mkdirSync(jobDir, { recursive: true });

    // 1. Unpack the library into <jobDir>/package
    jobs.update(jobId, { phase: 'unpacking' });
    const pkgDir = await unpack(input, jobDir, log);
    const pkgJson = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as { name: string; version: string };
    const meta: RemoteMeta = { remoteName, version: pkgJson.version ?? '0.0.0', packageName: pkgJson.name };
    log(`library: ${meta.packageName}@${meta.version}`);

    // 2. Introspect components + inputs
    jobs.update(jobId, { phase: 'introspecting' });
    const components = introspectLibrary(pkgDir);
    if (!components.length) return fail('no Angular components (ɵcmp) found in the library .d.ts');
    log(`discovered ${components.length} component(s): ${components.map((c) => c.widgetName).join(', ')}`);
    jobs.update(jobId, { components: components.map((c) => ({ name: c.widgetName, className: c.className, inputs: c.inputs })) });

    // 3. Scaffold the standalone remote workspace
    jobs.update(jobId, { phase: 'scaffolding' });
    const wsDir = join(jobDir, 'workspace');
    scaffoldRemote(wsDir, { remoteName, packageName: meta.packageName, packageSpec: `file:${pkgDir}`, port: 4400 },
      generateCapabilityTs(meta, components));

    // 4 + 5. Install + build — in a sandboxed container (or local, per config).
    jobs.update(jobId, { phase: 'installing' });
    jobs.update(jobId, { phase: 'building' });
    await ctx.builder.build(wsDir, remoteName, log);
    const distDir = join(wsDir, 'dist', remoteName);
    if (!existsSync(join(distDir, 'remoteEntry.json'))) return fail('build did not emit remoteEntry.json');

    // 6. Serve: copy artifacts to the served dir
    jobs.update(jobId, { phase: 'serving' });
    const served = join(ctx.artifactDir, 'remotes', remoteName);
    rmSync(served, { recursive: true, force: true });
    cpSync(distDir, served, { recursive: true });
    const remoteEntry = `${ctx.publicUrl}/remotes/${remoteName}/remoteEntry.json`;
    jobs.update(jobId, { remoteEntry });

    // 7. Register: registry.json + catalog kind:'component' rows
    jobs.update(jobId, { phase: 'registering' });
    ctx.registry.upsert({ remoteName, version: meta.version, remoteEntry, env: 'ingested' });
    const bodies = components.map((c) => componentCatalogBody(meta, remoteEntry, c));
    const r = await registerComponents(ctx.catalog, bodies);
    log(`catalog: ${r.registered} registered, ${r.skipped} existed${r.failed.length ? `, failed: ${r.failed.join('; ')}` : ''}`);

    jobs.update(jobId, { phase: 'registered' });
    log('done');
  } catch (e) {
    fail((e as Error).message);
  }
}

/** Resolve an npm spec (via `npm pack`) or an archive into a package dir with a package.json. */
async function unpack(input: IngestInput, jobDir: string, log: (l: string) => void): Promise<string> {
  const dest = join(jobDir, 'package');
  mkdirSync(dest, { recursive: true });
  let tgz: string;
  if (input.npm) {
    log(`npm pack ${input.npm}`);
    await sh('npm', ['pack', input.npm, '--pack-destination', jobDir], jobDir, log);
    tgz = firstFile(jobDir, '.tgz');
  } else if (input.archivePath) {
    tgz = input.archivePath;
  } else {
    throw new Error('provide { npm } or { archivePath }');
  }
  // npm/library tarballs unpack to a top-level `package/` dir.
  await sh('tar', ['-xzf', tgz, '-C', dest, '--strip-components', '1'], jobDir, log);
  if (!existsSync(join(dest, 'package.json'))) throw new Error('archive has no package.json at its root');
  return dest;
}

function firstFile(dir: string, ext: string): string {
  const f = readdirSync(dir).find((n) => n.endsWith(ext));
  if (!f) throw new Error(`no ${ext} produced`);
  return join(dir, f);
}

/** Shell a command, streaming stdout/stderr into the job log. Rejects on non-zero exit. */
function sh(cmd: string, args: string[], cwd: string, log: (l: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    log(`$ ${cmd} ${args.join(' ')}`);
    const child = execFile(cmd, args, { cwd, maxBuffer: 64 * 1024 * 1024, timeout: 15 * 60_000 });
    child.stdout?.on('data', (d) => log(String(d).trimEnd()));
    child.stderr?.on('data', (d) => log(String(d).trimEnd()));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}
