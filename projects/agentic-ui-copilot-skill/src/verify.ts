import { createVerify, KeyObject, createPublicKey } from 'node:crypto';

/**
 * GitHub Copilot Extensions sign every webhook request with the
 * private half of a published ECDSA P-256 key pair. The skill MUST
 * verify the signature before processing -- otherwise a malicious
 * caller could spoof a "user" message and run the agent against
 * the catalog with someone else's identity headers.
 *
 * Verification flow:
 *   1. Read X-GitHub-Public-Key-Identifier from the request.
 *   2. Look the key up at https://api.github.com/meta/public_keys/copilot_api
 *      (resolved fresh; GitHub rotates them).
 *   3. Verify the raw body bytes against the X-GitHub-Public-Key-Signature.
 *   4. Reject the request on any failure.
 *
 * We keep the resolver as a swappable function so tests can
 * inject a known key without hitting the GitHub API.
 *
 * @see https://docs.github.com/copilot/building-copilot-extensions/managing-the-lifecycle-of-a-copilot-extension/identifying-a-github-copilot-skill-installation#verifying-payload-signatures
 */
export interface VerifyOptions {
  readonly rawBody: string | Buffer;
  readonly signatureHeader: string | null | undefined;
  readonly keyIdentifierHeader: string | null | undefined;
  /** Resolves a key identifier to a PEM-encoded public key. The
   *  default fetches from GitHub. Tests inject a stub. */
  readonly resolveKey?: (keyId: string) => Promise<string | null>;
}

export interface VerifyResult {
  readonly valid: boolean;
  readonly reason?: 'missing-headers' | 'unknown-key' | 'bad-signature';
}

const COPILOT_PUBLIC_KEYS_URL =
  'https://api.github.com/meta/public_keys/copilot_api';

/** Production resolver -- hits GitHub's keys endpoint. Cached
 *  in-process for 10 minutes so verification stays fast. Spec
 *  notes GitHub keys are rotated occasionally; 10m is a safe
 *  short TTL. */
const keyCache = new Map<string, { pem: string; expiresAt: number }>();
const KEY_TTL_MS = 10 * 60_000;

export async function resolveCopilotKey(keyId: string): Promise<string | null> {
  const cached = keyCache.get(keyId);
  if (cached && cached.expiresAt > Date.now()) return cached.pem;
  let res: Response;
  try {
    res = await fetch(COPILOT_PUBLIC_KEYS_URL, {
      headers: { Accept: 'application/vnd.github+json' },
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const body = (await res.json()) as {
    public_keys?: Array<{ key_identifier: string; key: string }>;
  };
  for (const k of body.public_keys ?? []) {
    keyCache.set(k.key_identifier, {
      pem: k.key,
      expiresAt: Date.now() + KEY_TTL_MS,
    });
  }
  return keyCache.get(keyId)?.pem ?? null;
}

export async function verifyCopilotRequest(
  opts: VerifyOptions,
): Promise<VerifyResult> {
  const { rawBody, signatureHeader, keyIdentifierHeader } = opts;
  if (!signatureHeader || !keyIdentifierHeader) {
    return { valid: false, reason: 'missing-headers' };
  }
  const resolver = opts.resolveKey ?? resolveCopilotKey;
  const pem = await resolver(keyIdentifierHeader);
  if (!pem) return { valid: false, reason: 'unknown-key' };

  let publicKey: KeyObject;
  try {
    publicKey = createPublicKey(pem);
  } catch {
    return { valid: false, reason: 'unknown-key' };
  }

  const bodyBuf = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
  let signature: Buffer;
  try {
    signature = Buffer.from(signatureHeader, 'base64');
  } catch {
    return { valid: false, reason: 'bad-signature' };
  }

  const verifier = createVerify('SHA256');
  verifier.update(bodyBuf);
  verifier.end();
  const ok = verifier.verify(publicKey, signature);
  return ok ? { valid: true } : { valid: false, reason: 'bad-signature' };
}
