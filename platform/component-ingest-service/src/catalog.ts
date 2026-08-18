/**
 * Register the ingested components as `kind:'component'` capabilities in the Java
 * catalog (`:8081`, free-text kind) so the Studio's Page/Form designers list them
 * in their surface pickers. Idempotent: a 409 (already exists) is treated as OK.
 */
export interface ComponentRegistration {
  kind: 'component';
  name: string;
  lifecycle: 'published';
  body: Record<string, unknown>;
}

export interface CatalogTarget {
  catalogUrl: string;   // e.g. http://localhost:8081
  tenant: string;       // e.g. acme
  token?: string;       // bearer (oidc mode)
}

export async function registerComponents(
  target: CatalogTarget, regs: readonly ComponentRegistration[],
): Promise<{ registered: number; skipped: number; failed: string[] }> {
  const base = `${target.catalogUrl}/v1/catalogs/${encodeURIComponent(target.tenant)}/capabilities`;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (target.token) headers['authorization'] = `Bearer ${target.token}`;
  let registered = 0, skipped = 0;
  const failed: string[] = [];
  for (const reg of regs) {
    try {
      const res = await fetch(base, { method: 'POST', headers, body: JSON.stringify(reg) });
      if (res.ok) registered++;
      else if (res.status === 409) skipped++;             // already registered
      else failed.push(`${reg.name}: ${res.status}`);
    } catch (e) {
      failed.push(`${reg.name}: ${(e as Error).message}`);
    }
  }
  return { registered, skipped, failed };
}

/**
 * Remove a remote's `kind:'component'` rows from the catalog (best-effort) — used
 * when a remote is deleted, so its widgets disappear from the designer palettes
 * too. Matches rows whose `body.remoteName` equals the given remote.
 */
export async function unregisterComponents(
  target: CatalogTarget, remoteName: string,
): Promise<{ removed: number }> {
  const base = `${target.catalogUrl}/v1/catalogs/${encodeURIComponent(target.tenant)}/capabilities`;
  const headers: Record<string, string> = { accept: 'application/json' };
  if (target.token) headers['authorization'] = `Bearer ${target.token}`;
  let removed = 0;
  try {
    const res = await fetch(`${base}?kind=component`, { headers });
    if (!res.ok) return { removed };
    const { items } = (await res.json()) as { items: Array<{ id?: string; body?: { remoteName?: string } }> };
    for (const it of items) {
      if (it.id && it.body?.remoteName === remoteName) {
        const d = await fetch(`${base}/${it.id}`, { method: 'DELETE', headers });
        if (d.ok) removed++;
      }
    }
  } catch { /* best-effort */ }
  return { removed };
}
