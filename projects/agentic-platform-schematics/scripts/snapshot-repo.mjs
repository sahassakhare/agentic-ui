/**
 * Shared, security-aware repo snapshotter for the scaffold schematics.
 *
 * BOTH @infra-tools/agentic-platform-schematics (this package) and
 * @infra-tools/agentic-examples-schematics import this, so the SECURITY
 * exclusion list has ONE source of truth — a security-sensitive script must
 * never be able to leak into either scaffold. Runs at BUILD time only (the
 * published packages ship pre-built `dist/`).
 *
 * SECURITY: any file that could trip a security scanner is excluded — IdP/SSO
 * servers, token/key minting, load tests, DB/RLS scripts, `.env` files, private
 * keys/certs, `.npmrc`. Build artefacts (node_modules, dist, …) are excluded too.
 */
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';

// Always-skip build artefacts / local state.
const ARTIFACT_DIRS = new Set(['node_modules', 'dist', 'out-tsc', '.git', '.angular', 'coverage', '.nx', '.cache', 'tmp', 'data', '.idea', '.vscode', '_scaffold-out']);

// SECURITY exclusions — the "would blow an alarm" set.
const SECURITY_DIRS = new Set(['dev-jwks', 'secrets', 'credentials', '.secrets']);
const SECURITY_FILES = new Set([
  'sso.mjs', 'idp.mjs',                                   // auth-code + PKCE identity providers
  'mint-token.mjs', 'mint-dev-key.mjs',                  // token / signing-key minting
  'load-test.mjs',                                        // load generator
  'db-setup.sh', 'pg-sql.mjs', 'rls-db-test.mjs', 'rls-write-test.mjs',  // DB / RLS manipulation
  'verify-phase3.sh',
  '.npmrc', '.netrc',                                     // registry / network credentials
]);
const SECURITY_EXT = new Set(['.pem', '.key', '.crt', '.cer', '.p12', '.pfx', '.jks', '.keystore', '.asc', '.gpg']);

function isSecurity(name) {
  if (name === '.env') return true;
  if (name.startsWith('.env.') && !name.endsWith('.example')) return true;   // keep .env.example templates
  if (SECURITY_FILES.has(name)) return true;
  if (SECURITY_EXT.has(path.extname(name).toLowerCase())) return true;
  if (/^id_rsa|^id_ed25519/.test(name)) return true;
  return false;
}

/**
 * Snapshot selected repo content into a package's `src/scaffold/files/`.
 *
 * @param {object} opts
 * @param {string}   opts.pkgDir          absolute path to the schematics package root
 * @param {string[]} opts.topDirs         repo-root directories to include
 * @param {string[]} opts.topFiles        repo-root files to include
 * @param {boolean} [opts.includeTsconfig] also include root `tsconfig*.json`
 * @returns {Promise<{copied:number, excludedSecurity:string[]}>}
 */
export async function snapshotRepo({ pkgDir, topDirs, topFiles, includeTsconfig = false }) {
  const REPO = path.resolve(pkgDir, '..', '..');           // repo root (projects/<pkg> → repo)
  const FILES = path.join(pkgDir, 'src', 'scaffold', 'files');
  const excludedSecurity = [];
  let copied = 0;

  async function walk(absDir, relDir) {
    const entries = await fs.readdir(absDir, { withFileTypes: true });
    for (const e of entries) {
      const abs = path.join(absDir, e.name);
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (ARTIFACT_DIRS.has(e.name)) continue;
        // Never recurse into ANY schematics package's generated snapshot
        // (`*/src/scaffold/files`) — that would nest a snapshot in a snapshot.
        if (e.name === 'files' && path.basename(absDir) === 'scaffold') continue;
        if (SECURITY_DIRS.has(e.name)) { excludedSecurity.push(rel + '/'); continue; }
        await walk(abs, rel);
      } else if (e.isFile()) {
        if (e.name === '.DS_Store' || e.name.endsWith('.log')) continue;
        if (isSecurity(e.name)) { excludedSecurity.push(rel); continue; }
        const dest = path.join(FILES, rel);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.copyFile(abs, dest);
        copied++;
      }
    }
  }

  await fs.rm(FILES, { recursive: true, force: true });
  await fs.mkdir(FILES, { recursive: true });

  // root config files (+ optionally any tsconfig*.json)
  for (const e of await fs.readdir(REPO, { withFileTypes: true })) {
    if (!e.isFile()) continue;
    const keep = topFiles.includes(e.name) || (includeTsconfig && /^tsconfig.*\.json$/.test(e.name));
    if (!keep) continue;
    if (isSecurity(e.name)) { excludedSecurity.push(e.name); continue; }
    await fs.copyFile(path.join(REPO, e.name), path.join(FILES, e.name));
    copied++;
  }
  // selected top-level directories
  for (const d of topDirs) {
    if (existsSync(path.join(REPO, d))) await walk(path.join(REPO, d), d);
  }

  // Transparency: record what was excluded for security.
  const manifest = `# Excluded for security\n\nThe scaffold intentionally OMITS these files (auth/IdP, token/key minting,\nload tests, DB/RLS scripts, secrets, keys). Re-create them from your own\nsecrets management after scaffolding.\n\n${excludedSecurity.sort().map((f) => `- ${f}`).join('\n')}\n`;
  await fs.writeFile(path.join(pkgDir, 'EXCLUDED.md'), manifest);

  return { copied, excludedSecurity };
}
