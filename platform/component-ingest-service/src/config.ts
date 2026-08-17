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
} as const;
