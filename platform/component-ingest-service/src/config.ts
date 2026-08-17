import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = Number(process.env.PORT ?? 4320);
const rootTmp = join(tmpdir(), 'component-ingest');

/** Parse `name@range,@scope/name@range` into a deps map, merged over `base`. */
function parseDeps(env: string | undefined, base: Record<string, string>): Record<string, string> {
  const out = { ...base };
  for (const entry of (env ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const at = entry.lastIndexOf('@');
    if (at > 0) out[entry.slice(0, at)] = entry.slice(at + 1);
  }
  return out;
}

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
  /**
   * The host platform's Angular version. A federated remote shares Angular as a
   * singleton with the host, so the remote is built against this version and an
   * ingested library must be compatible with its major (else the build fails or
   * the component breaks at runtime under the host's Angular). Keep in sync with
   * the Studio/Hub apps.
   */
  hostAngularRange: process.env.HOST_ANGULAR_RANGE ?? '^21.0.0',
  /** Extra packages to externalize from federation sharing (comma-separated), on top of the defaults. */
  extraSkip: (process.env.EXTRA_SKIP ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  /**
   * Extra npm deps to install into every remote (`name@range,name@range`), merged over the
   * defaults: the platform runtime deps the published agentic-ui imports but doesn't declare
   * (kept in sync with the host), plus common library optional peers (chart.js for p-chart).
   */
  extraDeps: parseDeps(process.env.EXTRA_DEPS, {
    '@ag-ui/client': '^0.0.52',
    '@hashbrownai/core': '^0.4.1',
    'chart.js': '^4.5.1',
  }),

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

