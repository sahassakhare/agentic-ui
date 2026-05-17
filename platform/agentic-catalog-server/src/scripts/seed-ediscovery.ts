/**
 * Idempotent seeder for the eDiscovery demo tenant.
 *
 * Mirrors what `examples/demo-ediscovery-{shell,review,production,search}`
 * registers in code today — so a fresh catalog deployment reflects the
 * runtime tier's actual surface, not just empty tables.
 *
 * Usage:
 *   node dist/scripts/seed-ediscovery.js
 *
 * Or via npm:
 *   npm run seed:ediscovery
 *
 * Wired into Render's `preDeployCommand` (after migrations) in
 * `platform/render.yaml` so first-deploy + every subsequent deploy
 * keep the demo tenant populated. See ADR-025.
 *
 * Idempotency: checks for the tenant before creating; checks each
 * capability / MFE / role-mapping by `(kind, name)` / `name` /
 * `(claim_path, claim_value)` before inserting. Re-running is safe.
 */

import pg from 'pg';
import { loadConfig } from '../config.js';

const TENANT_ID = 'ediscovery';
const TENANT_DISPLAY = 'eDiscovery (live demo)';
const TENANT_QUOTAS = {
  monthlyTokens: 5_000_000,
  monthlyToolInvocations: 100_000,
  maxCapabilities: 100,
  maxMfeRemotes: 10,
};

interface CapabilitySeed {
  readonly kind: string;
  readonly name: string;
  readonly source: string;
  readonly tags: readonly string[];
  readonly owner?: string;
  readonly lifecycle?: 'draft' | 'published' | 'deprecated' | 'disabled';
}

interface MfeSeed {
  readonly name: string;
  readonly manifestUrl: string;
  readonly version: string;
  readonly exposes: Record<string, readonly string[]>;
}

interface RoleMappingSeed {
  readonly claimPath: string;
  readonly claimValue: string;
  readonly runtimePersona: string;
  readonly priority: number;
  readonly description: string;
}

const CAPABILITIES: readonly CapabilitySeed[] = [
  // ── shell tier (custodian + legal-hold core) ──
  { kind: 'tool', name: 'addCustodian', source: 'demo-ediscovery-shell', tags: ['ediscovery','shell'], owner: 'legal-platform-team' },
  { kind: 'tool', name: 'listCustodians', source: 'demo-ediscovery-shell', tags: ['ediscovery','shell'], owner: 'legal-platform-team' },
  { kind: 'tool', name: 'placeLegalHold', source: 'demo-ediscovery-shell', tags: ['ediscovery','shell'], owner: 'legal-platform-team' },
  { kind: 'tool', name: 'releaseLegalHold', source: 'demo-ediscovery-shell', tags: ['ediscovery','shell'], owner: 'legal-platform-team' },
  { kind: 'tool', name: 'acknowledgeLegalHold', source: 'demo-ediscovery-shell', tags: ['ediscovery','shell'], owner: 'legal-platform-team' },
  { kind: 'tool', name: 'listLegalHolds', source: 'demo-ediscovery-shell', tags: ['ediscovery','shell'], owner: 'legal-platform-team' },
  { kind: 'tool', name: 'openCustodianIntake', source: 'demo-ediscovery-shell', tags: ['ediscovery','shell','f1'], owner: 'legal-platform-team' },
  { kind: 'tool', name: 'generateCustodianIntakeForm', source: 'demo-ediscovery-shell', tags: ['ediscovery','shell','f1','llm-generated'], owner: 'legal-platform-team' },
  // ── shell components ──
  { kind: 'component', name: 'custodianCard', source: 'demo-ediscovery-shell', tags: ['ediscovery','shell','ui'] },
  { kind: 'component', name: 'legalHoldCard', source: 'demo-ediscovery-shell', tags: ['ediscovery','shell','ui'] },
  { kind: 'component', name: 'custodianIntakeCard', source: 'demo-ediscovery-shell', tags: ['ediscovery','shell','ui'] },
  { kind: 'component', name: 'placeLegalHoldCard', source: 'demo-ediscovery-shell', tags: ['ediscovery','shell','ui'] },
  { kind: 'component', name: 'mvk-approval-card', source: 'demo-ediscovery-shell', tags: ['ediscovery','shell','ui','f4'] },
  { kind: 'component', name: 'mvk-operation-progress', source: 'demo-ediscovery-shell', tags: ['ediscovery','shell','ui','f5'] },
  { kind: 'component', name: 'approval-summary-diff', source: 'demo-ediscovery-shell', tags: ['ediscovery','shell','ui','f4'] },
  { kind: 'component', name: 'dynamicFormCard', source: 'demo-ediscovery-shell', tags: ['ediscovery','shell','ui','f1'] },
  { kind: 'component', name: 'intake-identity-fields', source: 'demo-ediscovery-shell', tags: ['ediscovery','shell','ui','f1'] },
  { kind: 'component', name: 'intake-regulatory-consent', source: 'demo-ediscovery-shell', tags: ['ediscovery','shell','ui','f1'] },
  { kind: 'component', name: 'intake-supervisor-picker', source: 'demo-ediscovery-shell', tags: ['ediscovery','shell','ui','f1'] },
  { kind: 'component', name: 'intake-accounting-systems', source: 'demo-ediscovery-shell', tags: ['ediscovery','shell','ui','f1'] },
  // ── shell forms + datasource ──
  { kind: 'form', name: 'custodianIntakeForm', source: 'demo-ediscovery-shell', tags: ['ediscovery','shell','f1'] },
  { kind: 'form', name: 'placeLegalHold', source: 'demo-ediscovery-shell', tags: ['ediscovery','shell'] },
  { kind: 'datasource', name: 'users', source: 'demo-ediscovery-shell', tags: ['ediscovery','shell'] },

  // ── review remote ──
  { kind: 'tool', name: 'addToPrivilegeLog', source: 'demo-ediscovery-review', tags: ['ediscovery','review','federated'], owner: 'review-team' },
  { kind: 'tool', name: 'markPrivileged', source: 'demo-ediscovery-review', tags: ['ediscovery','review','federated'], owner: 'review-team' },
  { kind: 'tool', name: 'searchDocuments', source: 'demo-ediscovery-review', tags: ['ediscovery','review','federated'], owner: 'review-team' },
  { kind: 'tool', name: 'tagDocument', source: 'demo-ediscovery-review', tags: ['ediscovery','review','federated'], owner: 'review-team' },
  { kind: 'component', name: 'documentPreview', source: 'demo-ediscovery-review', tags: ['ediscovery','review','federated','ui'] },
  { kind: 'component', name: 'reviewProgress', source: 'demo-ediscovery-review', tags: ['ediscovery','review','federated','ui'] },
  { kind: 'component', name: 'tagPanel', source: 'demo-ediscovery-review', tags: ['ediscovery','review','federated','ui'] },

  // ── production remote ──
  { kind: 'tool', name: 'assignBatesNumbers', source: 'demo-ediscovery-production', tags: ['ediscovery','production','federated'], owner: 'production-team' },
  { kind: 'tool', name: 'createProductionSet', source: 'demo-ediscovery-production', tags: ['ediscovery','production','federated'], owner: 'production-team' },
  { kind: 'tool', name: 'exportProductionSet', source: 'demo-ediscovery-production', tags: ['ediscovery','production','federated'], owner: 'production-team' },
  { kind: 'tool', name: 'generateChainOfCustodyReport', source: 'demo-ediscovery-production', tags: ['ediscovery','production','federated','compliance'], owner: 'production-team' },
  { kind: 'tool', name: 'redactDocument', source: 'demo-ediscovery-production', tags: ['ediscovery','production','federated','sensitive'], owner: 'production-team' },
  { kind: 'component', name: 'batesPreview', source: 'demo-ediscovery-production', tags: ['ediscovery','production','federated','ui'] },
  { kind: 'component', name: 'chainOfCustodyReport', source: 'demo-ediscovery-production', tags: ['ediscovery','production','federated','ui'] },
  { kind: 'component', name: 'productionSummary', source: 'demo-ediscovery-production', tags: ['ediscovery','production','federated','ui'] },
  { kind: 'component', name: 'redactionEditor', source: 'demo-ediscovery-production', tags: ['ediscovery','production','federated','ui'] },

  // ── search remote ──
  { kind: 'tool', name: 'filterByCustodians', source: 'demo-ediscovery-search', tags: ['ediscovery','search','federated'], owner: 'search-team' },
  { kind: 'tool', name: 'filterByDateRange', source: 'demo-ediscovery-search', tags: ['ediscovery','search','federated'], owner: 'search-team' },
  { kind: 'tool', name: 'runTARClassifier', source: 'demo-ediscovery-search', tags: ['ediscovery','search','federated','ml'], owner: 'search-team' },
  { kind: 'tool', name: 'semanticSearch', source: 'demo-ediscovery-search', tags: ['ediscovery','search','federated','ml'], owner: 'search-team' },
  { kind: 'component', name: 'dateHistogram', source: 'demo-ediscovery-search', tags: ['ediscovery','search','federated','ui'] },
  { kind: 'component', name: 'searchResultPanel', source: 'demo-ediscovery-search', tags: ['ediscovery','search','federated','ui'] },
  { kind: 'component', name: 'tarScores', source: 'demo-ediscovery-search', tags: ['ediscovery','search','federated','ui'] },
];

const MFES: readonly MfeSeed[] = [
  {
    name: 'demo-ediscovery-review',
    manifestUrl: 'https://ediscovery-review.onrender.com/remoteEntry.json',
    version: '0.1.0',
    exposes: {
      capabilities: ['./Capability'],
      tools: ['addToPrivilegeLog','markPrivileged','searchDocuments','tagDocument'],
      widgets: ['documentPreview','reviewProgress','tagPanel'],
    },
  },
  {
    name: 'demo-ediscovery-production',
    manifestUrl: 'https://ediscovery-production.onrender.com/remoteEntry.json',
    version: '0.1.0',
    exposes: {
      capabilities: ['./Capability'],
      tools: ['assignBatesNumbers','createProductionSet','exportProductionSet','generateChainOfCustodyReport','redactDocument'],
      widgets: ['batesPreview','chainOfCustodyReport','productionSummary','redactionEditor'],
    },
  },
  {
    name: 'demo-ediscovery-search',
    manifestUrl: 'https://ediscovery-search.onrender.com/remoteEntry.json',
    version: '0.1.0',
    exposes: {
      capabilities: ['./Capability'],
      tools: ['filterByCustodians','filterByDateRange','runTARClassifier','semanticSearch'],
      widgets: ['dateHistogram','searchResultPanel','tarScores'],
    },
  },
];

const ROLE_MAPPINGS: readonly RoleMappingSeed[] = [
  { claimPath: 'role', claimValue: 'lead-counsel', runtimePersona: 'lead-counsel', priority: 400, description: 'Lead litigation partner — full audit + privileged tagging' },
  { claimPath: 'role', claimValue: 'associate', runtimePersona: 'associate', priority: 300, description: 'Associate — review + production but not release' },
  { claimPath: 'role', claimValue: 'lit-support', runtimePersona: 'lit-support', priority: 200, description: 'Lit-support engineer — TAR + search; no privileged docs' },
  { claimPath: 'role', claimValue: 'paralegal', runtimePersona: 'paralegal', priority: 100, description: 'Paralegal — custodian intake + legal-hold lifecycle' },
];

const SEEDED_BY = 'seed-ediscovery@auto-seed';

async function ensureTenant(client: pg.PoolClient): Promise<void> {
  const existing = await client.query(
    `SELECT id, status FROM tenants WHERE id = $1`,
    [TENANT_ID],
  );
  if (existing.rows.length > 0) {
    process.stdout.write(`  • tenant '${TENANT_ID}' already exists (${existing.rows[0].status})\n`);
    return;
  }
  await client.query(
    `INSERT INTO tenants (id, display_name, status, quotas, onboarded_at, onboarded_by)
     VALUES ($1, $2, 'active', $3::JSONB, now(), $4)`,
    [TENANT_ID, TENANT_DISPLAY, JSON.stringify(TENANT_QUOTAS), SEEDED_BY],
  );
  process.stdout.write(`  ✓ created tenant '${TENANT_ID}'\n`);
}

async function ensureCapability(client: pg.PoolClient, c: CapabilitySeed): Promise<boolean> {
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [TENANT_ID]);
  const existing = await client.query(
    `SELECT id FROM capabilities WHERE tenant_id = $1 AND kind = $2 AND name = $3 AND soft_deleted_at IS NULL`,
    [TENANT_ID, c.kind, c.name],
  );
  if (existing.rows.length > 0) return false;
  await client.query(
    `INSERT INTO capabilities (tenant_id, kind, name, body, lifecycle, owner, tags, created_by)
     VALUES ($1, $2, $3, $4::JSONB, $5, $6, $7, $8)`,
    [
      TENANT_ID,
      c.kind,
      c.name,
      JSON.stringify({ source: c.source }),
      c.lifecycle ?? 'published',
      c.owner ?? null,
      c.tags,
      SEEDED_BY,
    ],
  );
  return true;
}

async function ensureMfe(client: pg.PoolClient, m: MfeSeed): Promise<boolean> {
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [TENANT_ID]);
  const existing = await client.query(
    `SELECT id FROM mfe_remotes WHERE tenant_id = $1 AND name = $2`,
    [TENANT_ID, m.name],
  );
  if (existing.rows.length > 0) return false;
  await client.query(
    `INSERT INTO mfe_remotes (tenant_id, name, manifest_url, version, exposes, status)
     VALUES ($1, $2, $3, $4, $5::JSONB, 'active')`,
    [TENANT_ID, m.name, m.manifestUrl, m.version, JSON.stringify(m.exposes)],
  );
  return true;
}

async function ensureRoleMapping(client: pg.PoolClient, r: RoleMappingSeed): Promise<boolean> {
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [TENANT_ID]);
  const existing = await client.query(
    `SELECT id FROM role_mappings WHERE tenant_id = $1 AND claim_path = $2 AND claim_value = $3`,
    [TENANT_ID, r.claimPath, r.claimValue],
  );
  if (existing.rows.length > 0) return false;
  await client.query(
    `INSERT INTO role_mappings (tenant_id, claim_path, claim_value, runtime_persona, priority, enabled, description, created_by)
     VALUES ($1, $2, $3, $4, $5, TRUE, $6, $7)`,
    [TENANT_ID, r.claimPath, r.claimValue, r.runtimePersona, r.priority, r.description, SEEDED_BY],
  );
  return true;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = new pg.Pool({
    connectionString: config.DATABASE_URL,
    application_name: 'agentic-catalog-seed-ediscovery',
  });
  const client = await pool.connect();
  try {
    process.stdout.write('eDiscovery seed:\n');
    await ensureTenant(client);

    let capsAdded = 0;
    for (const c of CAPABILITIES) {
      if (await ensureCapability(client, c)) capsAdded++;
    }
    process.stdout.write(`  ✓ capabilities: ${capsAdded} added (${CAPABILITIES.length - capsAdded} already present)\n`);

    let mfesAdded = 0;
    for (const m of MFES) {
      if (await ensureMfe(client, m)) mfesAdded++;
    }
    process.stdout.write(`  ✓ MFE remotes: ${mfesAdded} added (${MFES.length - mfesAdded} already present)\n`);

    let rmAdded = 0;
    for (const r of ROLE_MAPPINGS) {
      if (await ensureRoleMapping(client, r)) rmAdded++;
    }
    process.stdout.write(`  ✓ role mappings: ${rmAdded} added (${ROLE_MAPPINGS.length - rmAdded} already present)\n`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('seed failed:', err);
  process.exit(1);
});
