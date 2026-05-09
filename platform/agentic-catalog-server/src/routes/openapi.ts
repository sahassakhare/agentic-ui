import { Hono } from 'hono';

/**
 * OpenAPI 3.1 spec endpoint. Hand-written for v0.1; the long-term
 * plan is auto-generation from the Zod schemas in `domain/` (via
 * `zod-to-openapi`), but the hand-written spec is auditable + stable
 * and matches the implementation 1:1 today.
 *
 * The spec describes ONLY the public, authenticated surface — health
 * routes (which are infrastructure-level) are documented in the
 * README, not the OpenAPI doc.
 */
export function openapiRoutes(): Hono {
  const app = new Hono();

  app.get('/openapi.json', (c) => c.json(SPEC));

  return app;
}

const SPEC = {
  openapi: '3.1.0',
  info: {
    title: '@maverick/agentic-catalog-server',
    version: '0.1.0',
    description:
      'Capability catalog server — control-plane T2 foundation. Multi-tenant capability registry, federated identity (OIDC/JWT), audit trail. See [ADR-015](https://github.com/sahassakhare/agentic-ui/blob/main/docs/adr/0015-catalog-server-design.md) for the design rationale.',
    license: { name: 'Apache-2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0' },
    contact: { url: 'https://github.com/sahassakhare/agentic-ui/issues' },
  },
  servers: [{ url: '/', description: 'Same-origin' }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'OIDC-issued JWT. The token must include `sub`, the configured tenant claim (default: `tenant_id`), and the configured roles claim (default: `roles`).',
      },
    },
    schemas: {
      Problem: {
        type: 'object',
        properties: {
          type: { type: 'string', format: 'uri' },
          title: { type: 'string' },
          status: { type: 'integer' },
          detail: { type: 'string' },
          requestId: { type: 'string' },
          errors: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                message: { type: 'string' },
              },
              required: ['path', 'message'],
            },
          },
        },
        required: ['type', 'title', 'status'],
      },
      Capability: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          tenantId: { type: 'string' },
          kind: { type: 'string', enum: [
            'tool', 'component', 'capability', 'backend', 'mfe',
            'action', 'intent', 'form', 'datasource',
            'validation', 'persistence', 'layout',
            'schema-transformer', 'approval', 'operation',
          ] },
          name: { type: 'string' },
          body: { type: 'object', additionalProperties: true },
          lifecycle: { type: 'string', enum: ['draft', 'published', 'deprecated', 'disabled'] },
          owner: { type: ['string', 'null'] },
          tags: { type: 'array', items: { type: 'string' } },
          requiredHostVersion: { type: ['string', 'null'] },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          createdBy: { type: 'string' },
          softDeletedAt: { type: ['string', 'null'], format: 'date-time' },
        },
        required: ['id', 'tenantId', 'kind', 'name', 'body', 'lifecycle', 'owner', 'tags', 'requiredHostVersion', 'createdAt', 'updatedAt', 'createdBy', 'softDeletedAt'],
      },
      MfeRemote: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          tenantId: { type: 'string' },
          name: { type: 'string' },
          manifestUrl: { type: 'string', format: 'uri' },
          version: { type: ['string', 'null'] },
          requiredHostVersion: { type: ['string', 'null'] },
          exposes: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } },
          status: { type: 'string', enum: ['active', 'inactive', 'degraded'] },
          lastHealthAt: { type: ['string', 'null'], format: 'date-time' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
        required: ['id', 'tenantId', 'name', 'manifestUrl', 'version', 'requiredHostVersion', 'exposes', 'status', 'lastHealthAt', 'createdAt', 'updatedAt'],
      },
      RoleMapping: {
        type: 'object',
        description:
          'IdP-claim → runtime-persona mapping. Resolution: highest-priority enabled mapping wins; ties broken by `created_at ASC`. See [ADR-016](https://github.com/sahassakhare/agentic-ui/blob/main/docs/adr/0016-iam-role-mapping.md).',
        properties: {
          id: { type: 'string', format: 'uuid' },
          tenantId: { type: 'string' },
          claimPath: { type: 'string', description: 'JWT claim to match against (default `groups`).' },
          claimValue: { type: 'string' },
          runtimePersona: { type: 'string', description: 'Persona id to activate (e.g. `lead-counsel`, `paralegal`).' },
          priority: { type: 'integer', minimum: 0, maximum: 10000 },
          enabled: { type: 'boolean' },
          description: { type: ['string', 'null'] },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          createdBy: { type: 'string' },
        },
        required: ['id', 'tenantId', 'claimPath', 'claimValue', 'runtimePersona', 'priority', 'enabled', 'description', 'createdAt', 'updatedAt', 'createdBy'],
      },
      RoleMappingCreate: {
        type: 'object',
        properties: {
          claimPath: { type: 'string', default: 'groups' },
          claimValue: { type: 'string' },
          runtimePersona: { type: 'string' },
          priority: { type: 'integer', default: 100 },
          enabled: { type: 'boolean', default: true },
          description: { type: ['string', 'null'] },
        },
        required: ['claimValue', 'runtimePersona'],
      },
      RoleMappingUpdate: {
        type: 'object',
        properties: {
          runtimePersona: { type: 'string' },
          priority: { type: 'integer' },
          enabled: { type: 'boolean' },
          description: { type: ['string', 'null'] },
        },
      },
      ResolveRequest: {
        type: 'object',
        properties: {
          claimPath: { type: 'string', default: 'groups' },
          claimValues: { type: 'array', maxItems: 64, items: { type: 'string', minLength: 1, maxLength: 400 } },
        },
        required: ['claimValues'],
      },
      ResolveResponse: {
        type: 'object',
        properties: {
          runtimePersona: { type: ['string', 'null'] },
          matchedClaimValues: { type: 'array', items: { type: 'string' } },
          mappingId: { type: ['string', 'null'], format: 'uuid' },
          priority: { type: ['integer', 'null'] },
        },
        required: ['runtimePersona', 'matchedClaimValues', 'mappingId', 'priority'],
      },
      AuditRow: {
        type: 'object',
        description:
          'A single hash-linked audit entry. Verifiers can re-derive `entryHash` from `prevHash` and the canonical encoding of the auditable fields. See [ADR-017](https://github.com/sahassakhare/agentic-ui/blob/main/docs/adr/0017-audit-chain.md).',
        properties: {
          id: { type: 'string', format: 'uuid' },
          tenantId: { type: 'string' },
          occurredAt: { type: 'string', format: 'date-time' },
          actor: { type: 'string' },
          requestId: { type: ['string', 'null'] },
          operation: { type: 'string', enum: ['create', 'update', 'delete', 'restore'] },
          entityType: { type: 'string' },
          entityId: { type: 'string' },
          diff: { type: ['object', 'null'], additionalProperties: true },
          chainPosition: { type: ['integer', 'null'] },
          prevHash: { type: ['string', 'null'] },
          entryHash: { type: ['string', 'null'] },
        },
        required: ['id', 'tenantId', 'occurredAt', 'actor', 'requestId', 'operation', 'entityType', 'entityId', 'diff', 'chainPosition', 'prevHash', 'entryHash'],
      },
      AuditVerifyResult: {
        type: 'object',
        properties: {
          valid: { type: 'boolean' },
          checkedRows: { type: 'integer' },
          chainHead: {
            type: ['object', 'null'],
            properties: {
              chainPosition: { type: 'integer' },
              entryHash: { type: 'string' },
            },
            required: ['chainPosition', 'entryHash'],
          },
          brokenAt: {
            type: ['object', 'null'],
            properties: {
              chainPosition: { type: 'integer' },
              reason: { type: 'string' },
            },
            required: ['chainPosition', 'reason'],
          },
        },
        required: ['valid', 'checkedRows', 'chainHead', 'brokenAt'],
      },
      UsageEvent: {
        type: 'object',
        description:
          'Per-tenant consumption event. Units, not currency — hosts compute money on top of these. See [ADR-018](https://github.com/sahassakhare/agentic-ui/blob/main/docs/adr/0018-usage-meter.md).',
        properties: {
          id: { type: 'string', format: 'uuid' },
          tenantId: { type: 'string' },
          occurredAt: { type: 'string', format: 'date-time' },
          kind: { type: 'string' },
          quantity: { type: 'integer' },
          tags: { type: 'object', additionalProperties: true },
          idempotencyKey: { type: ['string', 'null'] },
        },
        required: ['id', 'tenantId', 'occurredAt', 'kind', 'quantity', 'tags', 'idempotencyKey'],
      },
      UsageEventCreate: {
        type: 'object',
        properties: {
          kind: { type: 'string', description: 'Lower-case dotted/kebab vocabulary, host-defined.' },
          quantity: { type: 'integer', minimum: 0 },
          tags: { type: 'object', additionalProperties: true, default: {} },
          idempotencyKey: { type: 'string' },
          occurredAt: { type: 'string', format: 'date-time' },
        },
        required: ['kind', 'quantity'],
      },
      UsageAggregate: {
        type: 'object',
        properties: {
          from: { type: ['string', 'null'], format: 'date-time' },
          to: { type: ['string', 'null'], format: 'date-time' },
          byKind: { type: 'object', additionalProperties: { type: 'integer' } },
          totalEvents: { type: 'integer' },
          totalQuantity: { type: 'integer' },
        },
        required: ['from', 'to', 'byKind', 'totalEvents', 'totalQuantity'],
      },
      Tenant: {
        type: 'object',
        description:
          'Platform-level tenant. CRUD requires the `platform-admin` role. See [ADR-020](https://github.com/sahassakhare/agentic-ui/blob/main/docs/adr/0020-tenant-lifecycle.md).',
        properties: {
          id: { type: 'string' },
          displayName: { type: 'string' },
          status: { type: 'string', enum: ['active', 'suspended', 'deleted'] },
          quotas: { type: 'object', additionalProperties: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          onboardedAt: { type: ['string', 'null'], format: 'date-time' },
          onboardedBy: { type: ['string', 'null'] },
          suspendedAt: { type: ['string', 'null'], format: 'date-time' },
          suspendedBy: { type: ['string', 'null'] },
          suspendedReason: { type: ['string', 'null'] },
          deletedAt: { type: ['string', 'null'], format: 'date-time' },
        },
        required: ['id', 'displayName', 'status', 'quotas', 'createdAt', 'updatedAt', 'onboardedAt', 'onboardedBy', 'suspendedAt', 'suspendedBy', 'suspendedReason', 'deletedAt'],
      },
      TenantCreate: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Immutable tenant id; must match [a-zA-Z0-9_.-]+.' },
          displayName: { type: 'string' },
          quotas: { type: 'object', additionalProperties: true, default: {} },
        },
        required: ['id', 'displayName'],
      },
      TenantUpdate: {
        type: 'object',
        properties: {
          displayName: { type: 'string' },
          quotas: { type: 'object', additionalProperties: true },
        },
      },
      TenantSuspend: {
        type: 'object',
        properties: {
          reason: { type: 'string', minLength: 1, maxLength: 500 },
        },
        required: ['reason'],
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/v1/catalogs/{tenant}/capabilities': {
      get: {
        summary: 'List capabilities',
        parameters: [
          { name: 'tenant', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'kind', in: 'query', schema: { type: 'string' } },
          { name: 'lifecycle', in: 'query', schema: { type: 'string' } },
          { name: 'owner', in: 'query', schema: { type: 'string' } },
          { name: 'tag', in: 'query', schema: { type: 'string' } },
          { name: 'q', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
          { name: 'offset', in: 'query', schema: { type: 'integer' } },
          { name: 'includeDeleted', in: 'query', schema: { type: 'boolean' } },
        ],
        responses: {
          200: {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    items: { type: 'array', items: { $ref: '#/components/schemas/Capability' } },
                    total: { type: 'integer' },
                    limit: { type: 'integer' },
                    offset: { type: 'integer' },
                  },
                  required: ['items', 'total', 'limit', 'offset'],
                },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
        },
      },
      post: {
        summary: 'Create a capability',
        parameters: [{ name: 'tenant', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: {
          201: {
            description: 'Created',
            headers: { Location: { schema: { type: 'string' } } },
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Capability' } } },
          },
          422: { $ref: '#/components/responses/Unprocessable' },
        },
      },
    },
    '/v1/catalogs/{tenant}/capabilities/{id}': {
      parameters: [
        { name: 'tenant', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      get: {
        summary: 'Get one capability',
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Capability' } } } },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
      patch: {
        summary: 'Patch a capability',
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Capability' } } } },
          404: { $ref: '#/components/responses/NotFound' },
          422: { $ref: '#/components/responses/Unprocessable' },
        },
      },
      delete: {
        summary: 'Soft-delete a capability',
        responses: {
          204: { description: 'No Content' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/v1/catalogs/{tenant}/mfes': {
      get: {
        summary: 'List MFE remotes',
        parameters: [{ name: 'tenant', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    items: { type: 'array', items: { $ref: '#/components/schemas/MfeRemote' } },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        summary: 'Create an MFE remote',
        responses: { 201: { description: 'Created' } },
      },
    },
    '/v1/catalogs/{tenant}/role-mappings': {
      get: {
        summary: 'List role mappings',
        parameters: [{ name: 'tenant', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'OK — ordered by priority DESC, created_at ASC',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    items: { type: 'array', items: { $ref: '#/components/schemas/RoleMapping' } },
                  },
                  required: ['items'],
                },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
        },
      },
      post: {
        summary: 'Create a role mapping',
        description:
          'Mappings whose `runtimePersona` is in the protected set (default `platform-admin`, `lead-counsel`; configurable via `CATALOG_PROTECTED_PERSONAS`) require the caller to hold the `platform-admin` role; otherwise 403.',
        parameters: [{ name: 'tenant', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/RoleMappingCreate' } } },
        },
        responses: {
          201: {
            description: 'Created',
            headers: { Location: { schema: { type: 'string' } } },
            content: { 'application/json': { schema: { $ref: '#/components/schemas/RoleMapping' } } },
          },
          403: { $ref: '#/components/responses/Forbidden' },
          422: { $ref: '#/components/responses/Unprocessable' },
        },
      },
    },
    '/v1/catalogs/{tenant}/role-mappings/{id}': {
      parameters: [
        { name: 'tenant', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      get: {
        summary: 'Get one role mapping',
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/RoleMapping' } } } },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
      patch: {
        summary: 'Patch a role mapping',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/RoleMappingUpdate' } } },
        },
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/RoleMapping' } } } },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
          422: { $ref: '#/components/responses/Unprocessable' },
        },
      },
      delete: {
        summary: 'Delete a role mapping',
        responses: {
          204: { description: 'No Content' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/v1/catalogs/{tenant}/role-mappings/resolve': {
      post: {
        summary: 'Resolve claim values to a runtime persona',
        description:
          'Hot-path called by the runtime adapter after JWT decode. Returns the highest-priority enabled mapping that matches any of the supplied `claimValues`; ties broken by `created_at ASC`. `runtimePersona` is `null` when no enabled mapping matched — hosts decide on a fallback persona.',
        parameters: [{ name: 'tenant', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ResolveRequest' } } },
        },
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/ResolveResponse' } } } },
          422: { $ref: '#/components/responses/Unprocessable' },
        },
      },
    },
    '/v1/catalogs/{tenant}/audit/export': {
      get: {
        summary: 'Stream audit rows as JSONL',
        description:
          'Returns `application/x-ndjson` — one audit row per line, in chronological order. Per-line shape includes `chainPosition`, `prevHash`, `entryHash` so external verifiers can re-walk the chain end-to-end without database access.',
        parameters: [
          { name: 'tenant', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100000 } },
        ],
        responses: {
          200: {
            description: 'OK — JSONL stream',
            content: { 'application/x-ndjson': { schema: { type: 'string' } } },
          },
          422: { $ref: '#/components/responses/Unprocessable' },
        },
      },
    },
    '/v1/catalogs/{tenant}/audit/verify': {
      get: {
        summary: 'Re-walk and verify the audit chain',
        description:
          'Server-side chain re-walk. `valid:true` means every chained row\'s `entry_hash` matched the canonical re-derivation. `valid:false` reports the first broken position + reason — page oncall.',
        parameters: [{ name: 'tenant', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AuditVerifyResult' } } },
          },
        },
      },
    },
    '/v1/catalogs/{tenant}/usage': {
      post: {
        summary: 'Append a usage event',
        description:
          'Hosts call this hot-path as work is performed. The catalog stores `quantity` units; pricing is a host concern. Repeated POSTs with the same `idempotencyKey` resolve to the original row.',
        parameters: [{ name: 'tenant', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/UsageEventCreate' } } },
        },
        responses: {
          201: {
            description: 'Created (or original event for an idempotent replay)',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UsageEvent' } } },
          },
          422: { $ref: '#/components/responses/Unprocessable' },
        },
      },
      get: {
        summary: 'Aggregate usage over a time window',
        description: 'Sums `quantity` per `kind`. Optional `from` / `to` (ISO 8601) and `kind` filter.',
        parameters: [
          { name: 'tenant', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'kind', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          200: {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UsageAggregate' } } },
          },
          422: { $ref: '#/components/responses/Unprocessable' },
        },
      },
    },
    '/v1/tenants': {
      get: {
        summary: 'List tenants (platform-admin only)',
        parameters: [
          { name: 'includeDeleted', in: 'query', schema: { type: 'boolean' } },
        ],
        responses: {
          200: {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    items: { type: 'array', items: { $ref: '#/components/schemas/Tenant' } },
                  },
                  required: ['items'],
                },
              },
            },
          },
          403: { $ref: '#/components/responses/Forbidden' },
        },
      },
      post: {
        summary: 'Onboard a new tenant (platform-admin only)',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/TenantCreate' } } },
        },
        responses: {
          201: {
            description: 'Created',
            headers: { Location: { schema: { type: 'string' } } },
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Tenant' } } },
          },
          403: { $ref: '#/components/responses/Forbidden' },
          409: { description: 'Conflict — tenant id already exists' },
          422: { $ref: '#/components/responses/Unprocessable' },
        },
      },
    },
    '/v1/tenants/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      get: {
        summary: 'Get one tenant (platform-admin only)',
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Tenant' } } } },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
      patch: {
        summary: 'Patch displayName / quotas (platform-admin only)',
        description: 'Tenant id is immutable; status transitions go through `/suspend` and `/activate`.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/TenantUpdate' } } },
        },
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Tenant' } } } },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
          422: { $ref: '#/components/responses/Unprocessable' },
        },
      },
      delete: {
        summary: 'Soft-delete a tenant (platform-admin only)',
        responses: {
          204: { description: 'No Content' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/v1/tenants/{id}/suspend': {
      post: {
        summary: 'Suspend a tenant with a reason (platform-admin only)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/TenantSuspend' } } },
        },
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Tenant' } } } },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
          422: { $ref: '#/components/responses/Unprocessable' },
        },
      },
    },
    '/v1/tenants/{id}/activate': {
      post: {
        summary: 'Activate a previously-suspended tenant (platform-admin only)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Tenant' } } } },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/v1/catalogs/{tenant}/usage/recent': {
      get: {
        summary: 'Most recent usage events (debugging / ops console)',
        parameters: [
          { name: 'tenant', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 1000, default: 100 } },
        ],
        responses: {
          200: {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    items: { type: 'array', items: { $ref: '#/components/schemas/UsageEvent' } },
                  },
                  required: ['items'],
                },
              },
            },
          },
          422: { $ref: '#/components/responses/Unprocessable' },
        },
      },
    },
  },
} as const;
