#!/usr/bin/env node
// Generate a one-shot RSA key pair for the local-dev OIDC fixture.
// Writes:
//   platform/local-dev/dev-jwks/.well-known/jwks.json   (public)
//   platform/local-dev/dev-private.pem                  (private)
//
// Usage: node platform/local-dev/mint-dev-key.mjs

import { generateKeyPair, exportJWK, exportPKCS8 } from 'jose';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const { publicKey, privateKey } = await generateKeyPair('RS256');
const jwk = await exportJWK(publicKey);
jwk.kid = 'local-dev-key-1';
jwk.alg = 'RS256';
jwk.use = 'sig';

const jwksPath = join(__dirname, 'dev-jwks', '.well-known', 'jwks.json');
mkdirSync(dirname(jwksPath), { recursive: true });
writeFileSync(jwksPath, JSON.stringify({ keys: [jwk] }, null, 2) + '\n');

const pem = await exportPKCS8(privateKey);
const pemPath = join(__dirname, 'dev-private.pem');
writeFileSync(pemPath, pem);

console.log(`✓ wrote ${jwksPath}`);
console.log(`✓ wrote ${pemPath}`);
console.log('');
console.log('Restart the dev-jwks container to pick up the new JWKS:');
console.log('  docker compose -f platform/docker-compose.yml restart dev-jwks');
console.log('');
console.log('Then mint a token:');
console.log('  node platform/local-dev/mint-token.mjs --tenant test-tenant --roles platform-admin');
