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
import { CONFIG } from './config.js';
import { JobStore } from './jobs.js';
import { RegistryStore, parseSeed } from './registry.js';
import { runIngest, type IngestInput } from './pipeline.js';

const jobs = new JobStore();
const registry = new RegistryStore(CONFIG.registryFile, parseSeed(CONFIG.seedRemotes));
const app = new Hono();
app.use('*', cors());

app.get('/health', (c) => c.json({ status: 'ok' }));
app.get('/registry.json', (c) => c.json(registry.doc()));

app.post('/ingest', async (c) => {
  const input = (await c.req.json().catch(() => ({}))) as IngestInput & { remoteName?: string };
  if (!input.npm && !input.archivePath) return c.json({ error: 'provide { npm } or { archivePath }' }, 400);
  const remoteName = sanitizeRemote(input.remoteName ?? input.npm ?? input.archivePath ?? 'remote');
  const job = jobs.create(remoteName, new Date().toISOString());
  // Fire and forget; the client polls GET /ingest/:jobId.
  void runIngest(job.id, input, {
    workDir: CONFIG.workDir, artifactDir: CONFIG.artifactDir, publicUrl: CONFIG.publicUrl,
    catalog: { catalogUrl: CONFIG.catalogUrl, tenant: CONFIG.tenant }, jobs, registry,
  });
  return c.json({ jobId: job.id, remoteName }, 202);
});

app.get('/ingest/:jobId', (c) => {
  const job = jobs.get(c.req.param('jobId'));
  return job ? c.json(job) : c.json({ error: 'job not found' }, 404);
});

// Serve built artifacts: /remotes/<name>/remoteEntry.json + chunks.
app.use('/remotes/*', serveStatic({ root: CONFIG.artifactDir, rewriteRequestPath: (p) => p.replace(/^\/remotes/, '/remotes') }));

/** A package spec/name/path → a valid Native Federation remote name (`^[a-z0-9-]+$`). */
export function sanitizeRemote(spec: string): string {
  let s = spec.trim();
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
