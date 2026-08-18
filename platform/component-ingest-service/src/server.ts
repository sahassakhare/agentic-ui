/**
 * Component ingest service — HTTP API + static artifact host.
 *
 *   POST /ingest            { npm } | { archivePath }  → { jobId, remoteName }
 *   GET  /ingest/:jobId     → job status (phase, log, components, remoteEntry)
 *   GET  /registry.json     → { remotes: RemoteSpec[] }  (the Hub's MFE registry)
 *   GET  /remotes/*         → built remoteEntry.json + federation chunks
 *   GET  /health
 */
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG } from './config.js';
import { JobStore } from './jobs.js';
import { RegistryStore, parseSeed } from './registry.js';
import { runIngest, type IngestInput, type PipelineCtx } from './pipeline.js';
import { unregisterComponents } from './catalog.js';
import { DockerBuildRunner, LocalBuildRunner, type BuildRunner } from './build-runner.js';

const jobs = new JobStore();
const registry = new RegistryStore(CONFIG.registryFile, parseSeed(CONFIG.seedRemotes));
const builder: BuildRunner = CONFIG.buildSandbox === 'docker'
  ? new DockerBuildRunner({
      image: CONFIG.buildImage, memory: CONFIG.buildMemory, cpus: CONFIG.buildCpus,
      pidsLimit: CONFIG.buildPidsLimit, network: CONFIG.buildNetwork, readOnlyRoot: CONFIG.buildReadOnlyRoot,
    }, CONFIG.buildTimeoutMs)
  : new LocalBuildRunner(CONFIG.buildTimeoutMs);
const app = new Hono();
app.use('*', cors());

/** The pipeline context shared by /ingest and /admin/remotes/:name/reingest. */
function pipelineCtx(): PipelineCtx {
  return {
    workDir: CONFIG.workDir, artifactDir: CONFIG.artifactDir, publicUrl: CONFIG.publicUrl,
    catalog: { catalogUrl: CONFIG.catalogUrl, tenant: CONFIG.tenant }, jobs, registry, builder,
    hostAngularRange: CONFIG.hostAngularRange, extraSkip: CONFIG.extraSkip, extraDeps: CONFIG.extraDeps,
  };
}
const catalogTarget = { catalogUrl: CONFIG.catalogUrl, tenant: CONFIG.tenant };

app.get('/health', (c) => c.json({ status: 'ok', sandbox: CONFIG.buildSandbox }));
app.get('/registry.json', (c) => c.json(registry.doc()));

// ── MFE admin (Studio's MFEs page) ──────────────────────────────────────────
/** Full remote records incl. admin metadata (source, ingestedAt, disabled). */
app.get('/admin/remotes', (c) => c.json({ remotes: registry.adminList() }));

/** Enable/disable a remote — disabled remotes are omitted from /registry.json. */
app.patch('/admin/remotes/:name', async (c) => {
  const name = c.req.param('name');
  const body = (await c.req.json().catch(() => ({}))) as { disabled?: boolean };
  if (typeof body.disabled !== 'boolean') return c.json({ error: 'body must be { disabled: boolean }' }, 400);
  return registry.setDisabled(name, body.disabled)
    ? c.json({ remote: registry.get(name) })
    : c.json({ error: 'remote not found' }, 404);
});

/** Remove a remote: registry entry + served artifacts + its catalog component rows. */
app.delete('/admin/remotes/:name', async (c) => {
  const name = c.req.param('name');
  if (!registry.get(name)) return c.json({ error: 'remote not found' }, 404);
  registry.remove(name);
  rmSync(join(CONFIG.artifactDir, 'remotes', name), { recursive: true, force: true });
  const { removed } = await unregisterComponents(catalogTarget, name);
  return c.json({ removed: true, catalogRowsRemoved: removed });
});

/** Rebuild a remote from its stored ingest source (npm/url). */
app.post('/admin/remotes/:name/reingest', (c) => {
  const name = c.req.param('name');
  const rec = registry.get(name);
  if (!rec) return c.json({ error: 'remote not found' }, 404);
  const source = rec.source;
  if (!source?.npm && !source?.url) {
    return c.json({ error: 'no re-ingestable source (seeded or file-uploaded remote) — re-upload it' }, 400);
  }
  const input: IngestInput & { remoteName?: string } = { ...source, remoteName: name };
  const job = jobs.create(name, new Date().toISOString());
  void runIngest(job.id, input, pipelineCtx());
  return c.json({ jobId: job.id, remoteName: name }, 202);
});

app.post('/ingest', async (c) => {
  let input: IngestInput & { remoteName?: string };
  if ((c.req.header('content-type') ?? '').includes('multipart/form-data')) {
    const body = await c.req.parseBody();
    const file = body['file'];
    if (!(file instanceof File)) return c.json({ error: 'multipart upload requires a `file` field' }, 400);
    const dir = join(CONFIG.workDir, 'uploads');
    mkdirSync(dir, { recursive: true });
    const p = join(dir, `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
    writeFileSync(p, Buffer.from(await file.arrayBuffer()));
    input = {
      archivePath: p, remoteName: (body['remoteName'] as string) || file.name,
      discover: body['discover'] === 'true',
      include: parseInclude(body['include']),
    };
  } else {
    input = (await c.req.json().catch(() => ({}))) as IngestInput & { remoteName?: string };
  }
  if (!input.npm && !input.url && !input.archivePath) return c.json({ error: 'provide { npm }, { url }, or a multipart `file`' }, 400);
  const remoteName = sanitizeRemote(input.remoteName ?? input.npm ?? input.url ?? input.archivePath ?? 'remote');
  const job = jobs.create(remoteName, new Date().toISOString());
  // Fire and forget; the client polls GET /ingest/:jobId.
  void runIngest(job.id, input, pipelineCtx());
  return c.json({ jobId: job.id, remoteName }, 202);
});

app.get('/ingest/:jobId', (c) => {
  const job = jobs.get(c.req.param('jobId'));
  return job ? c.json(job) : c.json({ error: 'job not found' }, 404);
});

// Serve built artifacts: /remotes/<name>/remoteEntry.json + chunks.
app.use('/remotes/*', serveStatic({ root: CONFIG.artifactDir, rewriteRequestPath: (p) => p.replace(/^\/remotes/, '/remotes') }));

/** Parse a multipart `include` field (a JSON array of widget names) into a string[]. */
function parseInclude(v: unknown): string[] | undefined {
  if (typeof v !== 'string' || !v) return undefined;
  try { const a = JSON.parse(v); return Array.isArray(a) ? a.map(String) : undefined; } catch { return undefined; }
}

/** A package spec/name/path/URL → a valid Native Federation remote name (`^[a-z0-9-]+$`). */
export function sanitizeRemote(spec: string): string {
  let s = spec.trim().split(/[?#]/)[0];                                     // drop query/hash
  if (/^https?:\/\//i.test(s)) s = s.replace(/\/+$/, '').replace(/^.*\//, ''); // URL → last path segment
  if (/\.(tgz|zip)$/i.test(s)) {
    s = s.replace(/^.*[\\/]/, '').replace(/\.(tgz|zip)$/i, '');            // archive → basename
  } else {
    s = s.replace(/^(@[^/]+\/[^@]+|[^@]+)@.+$/, '$1');                     // npm spec → drop trailing @version
  }
  return s.replace(/^@/, '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase().replace(/^-+|-+$/g, '') || 'remote';
}

if (process.env.NODE_ENV !== 'test') {
  serve({ fetch: app.fetch, port: CONFIG.port }, (info) => {
    console.log(`[component-ingest] listening on :${info.port} (catalog ${CONFIG.catalogUrl}, tenant ${CONFIG.tenant})`);
  });
}

export { app };
