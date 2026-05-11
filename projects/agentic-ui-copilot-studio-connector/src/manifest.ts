import { zodToOpenApi } from './zod-to-openapi.js';
import type { ConnectorToolDef, OpenApiSchema } from './types.js';

/**
 * Build a Power Platform Connector OpenAPI 3 document from the
 * adopter's list of tools (ADR-042 D2). The output imports
 * straight into Power Platform via "Custom connector → Import an
 * OpenAPI file".
 *
 * Per-tool emission:
 *   - POST /actions/{toolName}
 *   - requestBody = OpenAPI translation of the tool's Zod schema
 *   - responses.200 = the agreed `ConnectorActionResult` shape
 *     (message + adaptiveCard + data) so Copilot Studio renders
 *     the card natively
 *
 * Output is plain JSON-serialisable; adopters write it to disk
 * or pipe it to the Connector publish CLI.
 */
export interface BuildManifestOptions {
  /** Connector title shown in Power Platform. */
  readonly title: string;
  /** Connector description shown in Power Platform. */
  readonly description: string;
  /** Connector version -- bump on schema-affecting changes. */
  readonly version: string;
  /** HTTPS host serving the agent webhook. Just the host, no
   *  protocol -- OpenAPI's `host` field. */
  readonly host: string;
  /** Base path under the host where the actions live, defaults
   *  to `/api/copilot-studio`. */
  readonly basePath?: string;
  /** Tool list. Each `schema` is either a Zod schema (preferred)
   *  or a hand-written OpenAPI fragment (`{ type: 'object', ... }`)
   *  that the builder uses verbatim. */
  readonly tools: readonly ConnectorToolDef[];
  /** Azure AD app id (the bot's appId / Connector audience). */
  readonly aadAppId: string;
  /** Optional tenant id; defaults to "common" for multi-tenant
   *  Connectors. */
  readonly aadTenantId?: string;
  /** Optional summary -> tag mapping. Tags group actions in the
   *  Copilot Studio UI. */
  readonly tagFor?: (tool: ConnectorToolDef) => string | undefined;
}

export interface ConnectorManifest {
  readonly swagger: '2.0';
  readonly info: { title: string; description: string; version: string };
  readonly host: string;
  readonly basePath: string;
  readonly schemes: readonly ['https'];
  readonly consumes: readonly ['application/json'];
  readonly produces: readonly ['application/json'];
  readonly securityDefinitions: Record<string, unknown>;
  readonly security: ReadonlyArray<Record<string, readonly string[]>>;
  readonly paths: Record<string, unknown>;
  readonly definitions: Record<string, unknown>;
  readonly tags: ReadonlyArray<{ name: string; description?: string }>;
}

const DEFAULT_BASE_PATH = '/api/copilot-studio';

export function buildConnectorManifest(opts: BuildManifestOptions): ConnectorManifest {
  const basePath = opts.basePath ?? DEFAULT_BASE_PATH;
  const tenant = opts.aadTenantId ?? 'common';
  const paths: Record<string, unknown> = {};
  const tagSet = new Set<string>();

  for (const tool of opts.tools) {
    const requestSchema: OpenApiSchema = isOpenApiFragment(tool.schema)
      ? (tool.schema as OpenApiSchema)
      : zodToOpenApi(tool.schema);
    const operationId = sanitizeOperationId(tool.name);
    const summary = tool.summary ?? humanize(tool.name);
    const tag = opts.tagFor?.(tool);
    if (tag) tagSet.add(tag);
    paths[`/actions/${tool.name}`] = {
      post: {
        operationId,
        summary,
        description: tool.description,
        ...(tag ? { tags: [tag] } : {}),
        parameters: [
          {
            in: 'body',
            name: 'body',
            required: true,
            schema: requestSchema,
          },
        ],
        responses: {
          '200': {
            description: 'Action completed',
            schema: ACTION_RESULT_SCHEMA,
          },
          '400': {
            description: 'Invalid arguments',
            schema: ERROR_SCHEMA,
          },
          '401': {
            description: 'Authentication failed',
            schema: ERROR_SCHEMA,
          },
          '500': {
            description: 'Internal error',
            schema: ERROR_SCHEMA,
          },
        },
      },
    };
  }

  return {
    swagger: '2.0',
    info: {
      title: opts.title,
      description: opts.description,
      version: opts.version,
    },
    host: opts.host,
    basePath,
    schemes: ['https'],
    consumes: ['application/json'],
    produces: ['application/json'],
    securityDefinitions: {
      'oauth2_auth': {
        type: 'oauth2',
        flow: 'accessCode',
        authorizationUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
        tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
        scopes: {
          [`api://${opts.aadAppId}/.default`]: 'Invoke catalog actions',
        },
      },
    },
    security: [{ 'oauth2_auth': [`api://${opts.aadAppId}/.default`] }],
    paths,
    definitions: {
      ConnectorActionResult: ACTION_RESULT_SCHEMA,
      ConnectorError: ERROR_SCHEMA,
    },
    tags: [...tagSet].map((name) => ({ name })),
  };
}

// ── shared response schemas ────────────────────────────────────────

const ACTION_RESULT_SCHEMA: OpenApiSchema = {
  type: 'object',
  properties: {
    message: { type: 'string', description: 'Plain-text reply for Copilot to read aloud.' },
    adaptiveCard: {
      type: 'object',
      additionalProperties: true,
      description: 'Adaptive Card 1.5 JSON. Rendered natively by Copilot Studio.',
    },
    data: {
      type: 'object',
      additionalProperties: true,
      description: 'Free-form payload for connector-native chaining.',
    },
  },
};

const ERROR_SCHEMA: OpenApiSchema = {
  type: 'object',
  properties: {
    error: { type: 'string' },
    detail: { type: 'string' },
  },
  required: ['error'],
};

// ── helpers ────────────────────────────────────────────────────────

function isOpenApiFragment(s: unknown): boolean {
  return Boolean(
    s
      && typeof s === 'object'
      && ((s as { type?: unknown }).type === 'object'
         || Array.isArray((s as { properties?: unknown }).properties))
      && !(s as { _def?: unknown })._def,
  );
}

function sanitizeOperationId(name: string): string {
  // Power Platform's operationId is camelCase, alphanumeric.
  return name.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function humanize(camelOrKebab: string): string {
  const spaced = camelOrKebab
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
