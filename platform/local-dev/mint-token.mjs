#!/usr/bin/env node
// Mint a local-dev JWT signed with dev-private.pem so the ops console
// (and direct curl calls) can authenticate against the catalog server.
//
// Usage:
//   node platform/local-dev/mint-token.mjs \
//       --tenant test-tenant --roles platform-admin
//
// Outputs the token to stdout. Pipe to pbcopy / xclip / a file.

import { SignJWT, importPKCS8 } from 'jose';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __dirname = dirname(fileURLToPath(import.meta.url));

const { values } = parseArgs({
  options: {
    sub:        { type: 'string', default: 'u-001' },
    tenant:     { type: 'string', default: 'test-tenant' },
    roles:      { type: 'string', default: 'member' },
    name:       { type: 'string', default: 'Local Dev' },
    audience:   { type: 'string', default: 'agentic-catalog' },
    'expires-in': { type: 'string', default: '8h' },
    issuer:     { type: 'string', default: 'http://dev-jwks/' },
  },
});

const pemPath = join(__dirname, 'dev-private.pem');
let pem;
try {
  pem = readFileSync(pemPath, 'utf-8');
} catch (err) {
  console.error(
    `Could not read ${pemPath}.\n` +
    `Run \`node platform/local-dev/mint-dev-key.mjs\` first to mint a key pair.`,
  );
  process.exit(1);
}
const privateKey = await importPKCS8(pem, 'RS256');

const roles = values.roles.split(',').map((r) => r.trim()).filter(Boolean);

const jwt = await new SignJWT({
  tenant_id: values.tenant,
  roles,
  name: values.name,
})
  .setProtectedHeader({ alg: 'RS256', kid: 'local-dev-key-1' })
  .setSubject(values.sub)
  .setIssuer(values.issuer)
  .setAudience(values.audience)
  .setIssuedAt()
  .setExpirationTime(values['expires-in'])
  .sign(privateKey);

process.stdout.write(jwt + '\n');
