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
  },
} as const;
