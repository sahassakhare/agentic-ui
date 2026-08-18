/**
 * The ingest pipeline: unpack → introspect → scaffold → npm install → ng build →
 * serve → register. The deterministic steps (introspect/generate/scaffold) are
 * unit-tested; the heavy steps (`npm install`, `ng build`) shell out. Runs async;
 * status is reported through the JobStore.
 */
import { execFile } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { introspectLibrary } from './introspect.js';
import { generateCapabilityTs, componentCatalogBody, type RemoteMeta } from './generate.js';
import { scaffoldRemote } from './scaffold.js';
import { registerComponents, type CatalogTarget } from './catalog.js';
import type { BuildRunner } from './build-runner.js';
import type { JobStore } from './jobs.js';
import type { RegistryStore } from './registry.js';

export interface IngestInput {
  /** An npm spec (`@progress/kendo-angular-buttons@1.2.3`). */
  readonly npm?: string;
  /** A URL to a `.tgz` tarball (e.g. an npm registry / release asset URL). */
  readonly url?: string;
  /** A local path to an uploaded `.tgz`/`.zip`. */
  readonly archivePath?: string;
  /** Discover the library's components and stop (don't build) — for the selection UI. */
  readonly discover?: boolean;
  /** Build only these components (by widget name); empty/absent = all discovered. */
  readonly include?: readonly string[];
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
  /** The host platform's Angular version — the remote builds against it (see config). */
  readonly hostAngularRange: string;
  /** Extra packages to externalize from federation, beyond the built-in defaults. */
  readonly extraSkip?: readonly string[];
  /** Extra npm deps to install into the remote (platform companions + library optional peers). */
  readonly extraDeps?: Readonly<Record<string, string>>;
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

    // 1. Unpack the library into <jobDir>/package (+ a tarball we install from)
    jobs.update(jobId, { phase: 'unpacking' });
    const { pkgDir, tarball } = await unpack(input, jobDir, log);
    const pkgJson = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as {
      name: string; version: string;
      dependencies?: Record<string, string>; peerDependencies?: Record<string, string>;
    };
    const meta: RemoteMeta = { remoteName, version: pkgJson.version ?? '0.0.0', packageName: pkgJson.name };
    log(`library: ${meta.packageName}@${meta.version}`);

    // The remote shares Angular as a singleton with the host, so a library built
    // for a different Angular major can't load — catch it here with clear guidance
    // instead of a cryptic build/runtime failure.
    const hostMajor = majorOf(ctx.hostAngularRange);
    const libNgRange = pkgJson.peerDependencies?.['@angular/core'] ?? pkgJson.dependencies?.['@angular/core'];
    const libMajor = libNgRange ? majorOf(libNgRange) : null;
    if (libMajor !== null && hostMajor !== null && libMajor !== hostMajor) {
      return fail(`${meta.packageName}@${meta.version} requires Angular ${libNgRange} (v${libMajor}), but the platform runs Angular v${hostMajor}. `
        + `Ingest a version of ${meta.packageName} compatible with Angular ${hostMajor} (e.g. a matching major).`);
    }

    // 2. Introspect components + inputs
    jobs.update(jobId, { phase: 'introspecting' });
    const components = introspectLibrary(pkgDir);
    if (!components.length) return fail('no Angular components (ɵcmp) found in the library .d.ts');
    log(`discovered ${components.length} component(s): ${components.map((c) => c.widgetName).join(', ')}`);
    jobs.update(jobId, { components: components.map((c) => ({ name: c.widgetName, className: c.className, inputs: c.inputs })) });

    // Discovery only — stop so the caller can present the list for selection.
    if (input.discover) {
      jobs.update(jobId, { phase: 'discovered' });
      log('discovery complete — select which components to build');
      return;
    }

    // Build only the selected components (empty/absent = all). Selecting a subset
    // cuts build time + memory and avoids pulling components' optional peers.
    const include = input.include ?? [];
    const selected = include.length ? components.filter((c) => include.includes(c.widgetName)) : components;
    if (!selected.length) return fail('none of the selected components were found in the library');
    if (include.length) {
      log(`building ${selected.length} of ${components.length} selected component(s)`);
      jobs.update(jobId, { components: selected.map((c) => ({ name: c.widgetName, className: c.className, inputs: c.inputs })) });
    }

    // 3. Scaffold the standalone remote workspace
    jobs.update(jobId, { phase: 'scaffolding' });
    const wsDir = join(jobDir, 'workspace');
    // Install from the tarball (npm copies it into node_modules with its deps as
    // siblings) — a `file:` link to the unpacked dir leaves the library's fesm
    // files unable to resolve their own dependencies from the workspace.
    scaffoldRemote(wsDir,
      { remoteName, packageName: meta.packageName, packageSpec: `file:${tarball}`, port: 4400,
        angularRange: ctx.hostAngularRange, skip: ctx.extraSkip, extraDeps: ctx.extraDeps },
      generateCapabilityTs(meta, selected));

    // 4 + 5. Install + build — in a sandboxed container (or local, per config).
    jobs.update(jobId, { phase: 'installing' });
    jobs.update(jobId, { phase: 'building' });
    await ctx.builder.build(wsDir, remoteName, log);
    // @angular/build:application nests output under a `browser/` subdir; fall back to the
    // root for other builders.
    const outRoot = join(wsDir, 'dist', remoteName);
    const distDir = existsSync(join(outRoot, 'browser', 'remoteEntry.json')) ? join(outRoot, 'browser') : outRoot;
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
    ctx.registry.upsert(
      { remoteName, version: meta.version, remoteEntry, type: 'native-federation', env: 'ingested' },
      { source: input.npm ? { npm: input.npm } : input.url ? { url: input.url } : undefined, ingestedAt: new Date().toISOString() },
    );
    const bodies = selected.map((c) => componentCatalogBody(meta, remoteEntry, c));
    const r = await registerComponents(ctx.catalog, bodies);
    log(`catalog: ${r.registered} registered, ${r.skipped} existed${r.failed.length ? `, failed: ${r.failed.join('; ')}` : ''}`);

    jobs.update(jobId, { phase: 'registered' });
    log('done');
  } catch (e) {
    fail((e as Error).message);
  }
}

/**
 * Resolve an npm spec / URL / uploaded archive into both an unpacked package dir
 * (for introspection) and a `.tgz` tarball (installed via `file:` so npm copies
 * the library + its deps into the workspace node_modules).
 */
async function unpack(input: IngestInput, jobDir: string, log: (l: string) => void): Promise<{ pkgDir: string; tarball: string }> {
  const dest = join(jobDir, 'package');
  mkdirSync(dest, { recursive: true });
  let tgz: string;
  if (input.npm) {
    log(`npm pack ${input.npm}`);
    await sh('npm', ['pack', input.npm, '--pack-destination', jobDir], jobDir, log);
    tgz = firstFile(jobDir, '.tgz');
  } else if (input.url) {
    log(`download ${input.url}`);
    const res = await fetch(input.url);
    if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText}`);
    tgz = join(jobDir, 'download.tgz');
    writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
  } else if (input.archivePath && /\.zip$/i.test(input.archivePath)) {
    // A zip can't be `npm install`ed — unzip, find the package root, repack to a tgz.
    const unz = join(jobDir, 'unzipped');
    mkdirSync(unz, { recursive: true });
    await sh('unzip', ['-q', input.archivePath, '-d', unz], jobDir, log);
    const root = findPackageRoot(unz);
    await sh('npm', ['pack', root, '--pack-destination', jobDir], jobDir, log);
    tgz = firstFile(jobDir, '.tgz');
  } else if (input.archivePath) {
    tgz = input.archivePath;
  } else {
    throw new Error('provide { npm }, { url }, or { archivePath }');
  }
  // npm/library tarballs unpack to a top-level `package/` dir.
  await sh('tar', ['-xzf', tgz, '-C', dest, '--strip-components', '1'], jobDir, log);
  if (!existsSync(join(dest, 'package.json'))) throw new Error('archive has no package.json at its root');
  return { pkgDir: dest, tarball: tgz };
}

/** Find the dir containing package.json within an unzipped archive (root or one level down). */
function findPackageRoot(dir: string): string {
  if (existsSync(join(dir, 'package.json'))) return dir;
  for (const name of readdirSync(dir)) {
    const sub = join(dir, name);
    if (existsSync(join(sub, 'package.json'))) return sub;
  }
  throw new Error('zip has no package.json at its root or first level');
}

/** Major version from a semver range like `^21.0.0` / `>=20 <22` → 21 / 20 (first number seen). */
function majorOf(range: string): number | null {
  const m = range.match(/(\d+)/);
  return m ? Number(m[1]) : null;
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
