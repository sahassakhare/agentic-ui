/**
 * The MFE registry the Hub reads (`GET /registry.json` → `{ remotes: RemoteSpec[] }`).
 * Seeded with any pre-existing remotes (e.g. matter-management) so pointing the Hub
 * here doesn't lose them; ingested remotes are appended + persisted to a JSON file.
 * RemoteSpec matches the lib's `RemoteSpecSchema` (`projects/agentic-ui/src/lib/mfe/manifest.ts`).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface RemoteSpec {
  remoteName: string;
  version: string;
  remoteEntry: string;       // URL of remoteEntry.json
  env?: string;
  capabilityManifestUrl?: string;
}

export class RegistryStore {
  private remotes = new Map<string, RemoteSpec>();

  constructor(private readonly file: string, seed: RemoteSpec[] = []) {
    for (const r of seed) this.remotes.set(r.remoteName, r);
    if (existsSync(file)) {
      try {
        const doc = JSON.parse(readFileSync(file, 'utf8')) as { remotes?: RemoteSpec[] };
        for (const r of doc.remotes ?? []) this.remotes.set(r.remoteName, r);
      } catch { /* start from seed */ }
    }
  }

  list(): RemoteSpec[] { return [...this.remotes.values()]; }
  doc(): { remotes: RemoteSpec[] } { return { remotes: this.list() }; }

  upsert(spec: RemoteSpec): void {
    this.remotes.set(spec.remoteName, spec);
    this.persist();
  }

  private persist(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.doc(), null, 2));
  }
}

/** Parse a `SEED_REMOTES` env value (JSON array of RemoteSpec) — best effort. */
export function parseSeed(env: string | undefined): RemoteSpec[] {
  if (!env) return [];
  try { const v = JSON.parse(env); return Array.isArray(v) ? v : []; } catch { return []; }
}
