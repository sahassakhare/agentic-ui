import { randomUUID } from 'node:crypto';

/**
 * Per-process replica identifier. Generated once at module load
 * (effectively at server startup for the catalog process), used to
 * tag pg_notify payloads so the LISTEN handler on the originating
 * replica can skip the echo of its own emit.
 *
 * Stable for the lifetime of the process. Different across replicas
 * because each replica is a different node process.
 */
export const REPLICA_ID = randomUUID();
