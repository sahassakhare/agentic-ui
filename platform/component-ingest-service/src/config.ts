import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = Number(process.env.PORT ?? 4320);
const rootTmp = join(tmpdir(), 'component-ingest');

/** Service configuration (all overridable via env). */
export const CONFIG = {
  port,
  catalogUrl: process.env.CATALOG_URL ?? 'http://localhost:8081',
  tenant: process.env.TENANT ?? 'acme',
  /** Public base URL for remoteEntry links (what the Hub fetches). */
  publicUrl: process.env.PUBLIC_URL ?? `http://localhost:${port}`,
  workDir: process.env.WORK_DIR ?? join(rootTmp, 'work'),
  artifactDir: process.env.ARTIFACT_DIR ?? join(rootTmp, 'artifacts'),
  registryFile: process.env.REGISTRY_FILE ?? join(rootTmp, 'registry.json'),
  /** JSON array of pre-existing RemoteSpec to seed registry.json (e.g. matter-management). */
  seedRemotes: process.env.SEED_REMOTES,

  // ── build sandbox (B3) ──────────────────────────────────────────────────────
  /** 'docker' isolates each build in an ephemeral container; 'local' runs in-process (trusted only). */
  buildSandbox: (process.env.BUILD_SANDBOX ?? 'local') as 'docker' | 'local',
  buildImage: process.env.BUILD_IMAGE ?? 'node:20-bookworm',
  buildMemory: process.env.BUILD_MEMORY ?? '4g',
  buildCpus: process.env.BUILD_CPUS ?? '2',
  buildPidsLimit: Number(process.env.BUILD_PIDS_LIMIT ?? 512),
  /** 'bridge' lets npm reach the registry; 'none' requires pre-fetched deps. */
  buildNetwork: process.env.BUILD_NETWORK ?? 'bridge',
  buildReadOnlyRoot: process.env.BUILD_READONLY_ROOT !== 'false',
  buildTimeoutMs: Number(process.env.BUILD_TIMEOUT_MS ?? 15 * 60_000),
} as const;

