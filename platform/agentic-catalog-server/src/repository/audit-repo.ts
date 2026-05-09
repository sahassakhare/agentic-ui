import type pg from 'pg';

export type AuditOperation = 'create' | 'update' | 'delete' | 'restore';

export interface AuditAppendInput {
  readonly tenantId: string;
  readonly actor: string;
  readonly requestId: string | null;
  readonly operation: AuditOperation;
  readonly entityType: string;
  readonly entityId: string;
  readonly diff: Record<string, unknown> | null;
}

/**
 * Append an audit event. Catalog mutations call this inside the same
 * transaction as the data write so the audit row is consistent with
 * the underlying change (atomically committed; atomically rolled back
 * if the data write fails).
 *
 * The `catalog_audit` table is INSERT-only by RLS policy + by app
 * convention. No update / delete primitives are exposed.
 */
export async function appendAudit(
  client: pg.PoolClient,
  input: AuditAppendInput,
): Promise<void> {
  await client.query(
    `INSERT INTO catalog_audit
       (tenant_id, actor, request_id, operation, entity_type, entity_id, diff)
     VALUES ($1, $2, $3, $4, $5, $6, $7::JSONB)`,
    [
      input.tenantId,
      input.actor,
      input.requestId,
      input.operation,
      input.entityType,
      input.entityId,
      input.diff === null ? null : JSON.stringify(input.diff),
    ],
  );
}
