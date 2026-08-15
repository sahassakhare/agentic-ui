/**
 * Snapshot the repo into the schematic's template `files/` directory, so the
 * scaffold schematic can regenerate the whole monorepo. Runs at build/publish
 * time — the snapshot is NOT committed (see .gitignore).
 *
 * SECURITY: any file that could trip a security scanner is excluded — IdP/SSO
 * servers, token/key minting, load tests, DB/RLS scripts, `.env` files, private
 * keys/certs, `.npmrc`. Build artefacts (node_modules, dist, …) are excluded too.
 */
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');                 // projects/agentic-platform-schematics
const REPO = path.resolve(PKG, '..', '..');           // repo root
const FILES = path.join(PKG, 'src', 'scaffold', 'files');

// What to include from the repo root.
const TOP_DIRS = ['projects', 'platform', 'examples', 'docs'];
const TOP_FILES = ['package.json', 'angular.json', 'README.md', '.editorconfig', '.gitignore', '.prettierrc', 'LICENSE'];

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

const excludedSecurity = [];
let copied = 0;

async function walk(absDir, relDir) {
  const entries = await fs.readdir(absDir, { withFileTypes: true });
  for (const e of entries) {
    const abs = path.join(absDir, e.name);
    const rel = relDir ? `${relDir}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (ARTIFACT_DIRS.has(e.name)) continue;
      if (abs === FILES || abs === path.join(PKG, 'dist')) continue;         // no self-recursion
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

async function main() {
  await fs.rm(FILES, { recursive: true, force: true });
  await fs.mkdir(FILES, { recursive: true });

  // root config files (+ any tsconfig*.json)
  for (const e of await fs.readdir(REPO, { withFileTypes: true })) {
    if (!e.isFile()) continue;
    const keep = TOP_FILES.includes(e.name) || /^tsconfig.*\.json$/.test(e.name);
    if (!keep) continue;
    if (isSecurity(e.name)) { excludedSecurity.push(e.name); continue; }
    await fs.copyFile(path.join(REPO, e.name), path.join(FILES, e.name));
    copied++;
  }
  // top-level directories
  for (const d of TOP_DIRS) {
    if (existsSync(path.join(REPO, d))) await walk(path.join(REPO, d), d);
  }

  // Transparency: record what was excluded for security.
  const manifest = `# Excluded for security\n\nThe scaffold intentionally OMITS these files (auth/IdP, token/key minting,\nload tests, DB/RLS scripts, secrets, keys). Re-create them from your own\nsecrets management after scaffolding.\n\n${excludedSecurity.sort().map((f) => `- ${f}`).join('\n')}\n`;
  await fs.writeFile(path.join(PKG, 'EXCLUDED.md'), manifest);

  console.log(`✓ Snapshot complete: ${copied} files copied into files/`);
  console.log(`✓ Excluded ${excludedSecurity.length} security-sensitive item(s) (see EXCLUDED.md):`);
  for (const f of excludedSecurity.sort().slice(0, 40)) console.log('   -', f);
  if (excludedSecurity.length > 40) console.log(`   … +${excludedSecurity.length - 40} more`);
}

main().catch((err) => { console.error(err); process.exit(1); });
