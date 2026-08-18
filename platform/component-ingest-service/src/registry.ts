/**
 * The MFE registry the Hub reads (`GET /registry.json` → `{ remotes: RemoteSpec[] }`).
 * Seeded with any pre-existing remotes (e.g. matter-management) so pointing the Hub
 * here doesn't lose them; ingested remotes are appended + persisted to a JSON file.
 * RemoteSpec matches the lib's `RemoteSpecSchema` (`projects/agentic-ui/src/lib/mfe/manifest.ts`).
 *
 * Internally each entry also carries admin metadata (the ingest `source`, an
 * `ingestedAt` stamp, a `disabled` flag) so the Studio's MFEs page can manage
 * remotes. That metadata is NOT emitted in the public `registry.json` — the Hub
 * sees only canonical RemoteSpec fields, and disabled remotes are omitted so the
 * Hub stops loading them.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface RemoteSpec {
  remoteName: string;
  version: string;
  remoteEntry: string;       // URL of remoteEntry.json
  /** Federation runtime that built the remote — the ingest service builds native-federation. */
  type?: 'native-federation' | 'module-federation' | 'module-federation-1';
  env?: string;
  capabilityManifestUrl?: string;
}

/** The ingest input that produced a remote — enough to re-ingest it. */
export interface RemoteSource {
  npm?: string;
  url?: string;
}

/** A stored remote: its public spec + admin metadata. */
export interface RemoteRecord extends RemoteSpec {
  disabled?: boolean;
  source?: RemoteSource;
  ingestedAt?: string;
}

const SPEC_KEYS: (keyof RemoteSpec)[] = ['remoteName', 'version', 'remoteEntry', 'type', 'env', 'capabilityManifestUrl'];

function toSpec(r: RemoteRecord): RemoteSpec {
  const out: Record<string, unknown> = {};
  for (const k of SPEC_KEYS) if (r[k] !== undefined) out[k] = r[k];
  return out as unknown as RemoteSpec;
}

export class RegistryStore {
  private remotes = new Map<string, RemoteRecord>();

  constructor(private readonly file: string, seed: RemoteRecord[] = []) {
    for (const r of seed) this.remotes.set(r.remoteName, r);
    if (existsSync(file)) {
      try {
        const doc = JSON.parse(readFileSync(file, 'utf8')) as { remotes?: RemoteRecord[] };
        for (const r of doc.remotes ?? []) this.remotes.set(r.remoteName, r);
      } catch { /* start from seed */ }
    }
  }

  /** Full records incl. admin metadata — for the Studio's MFEs page. */
  adminList(): RemoteRecord[] { return [...this.remotes.values()]; }
  get(name: string): RemoteRecord | undefined { return this.remotes.get(name); }

  /** The public MFE registry: enabled remotes only, projected to canonical fields. */
  doc(): { remotes: RemoteSpec[] } {
    return { remotes: this.adminList().filter((r) => !r.disabled).map(toSpec) };
  }

  upsert(spec: RemoteSpec, meta: { source?: RemoteSource; ingestedAt?: string } = {}): void {
    const prev = this.remotes.get(spec.remoteName);
    this.remotes.set(spec.remoteName, {
      ...spec,
      disabled: prev?.disabled,                       // preserve a disabled flag across re-ingest
      source: meta.source ?? prev?.source,
      ingestedAt: meta.ingestedAt ?? prev?.ingestedAt,
    });
    this.persist();
  }

  remove(name: string): boolean {
    const had = this.remotes.delete(name);
    if (had) this.persist();
    return had;
  }

  setDisabled(name: string, disabled: boolean): boolean {
    const r = this.remotes.get(name);
    if (!r) return false;
    this.remotes.set(name, { ...r, disabled });
    this.persist();
    return true;
  }

  private persist(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    // Persist the FULL records (admin metadata included) so it survives a restart.
    writeFileSync(this.file, JSON.stringify({ remotes: this.adminList() }, null, 2));
  }
}

/** Parse a `SEED_REMOTES` env value (JSON array of RemoteSpec) — best effort. */
export function parseSeed(env: string | undefined): RemoteRecord[] {
  if (!env) return [];
  try { const v = JSON.parse(env); return Array.isArray(v) ? v : []; } catch { return []; }
}
