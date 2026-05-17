/**
 * Wire types for the Microsoft Copilot Studio Connector adapter.
 * Mirrors ADR-042's D1 + D4 shape; keeps the surface small.
 */

/** One catalog tool described enough for OpenAPI emission. */
export interface ConnectorToolDef {
  readonly name: string;
  readonly description: string;
  /** Zod-shaped schema OR a hand-written OpenAPI fragment. Both
   *  routes land at the same OpenAPI 3 path via the translator. */
  readonly schema: unknown;
  /** Optional `summary` text the Copilot Studio UI renders as
   *  the action's display name. Defaults to a humanised name. */
  readonly summary?: string;
}

/** Identity surfaced to handlers, mapped from the validated JWT
 *  claims. Adopter then translates this into the catalog
 *  principal via the existing role-mappings table (ADR-016). */
export interface ConnectorIdentity {
  /** AAD tenant id (`tid` claim). */
  readonly tenantId: string;
  /** AAD object id (`oid` claim) -- stable across name changes. */
  readonly userObjectId: string;
  /** User principal name (`preferred_username` claim). */
  readonly userPrincipalName: string | null;
  /** AAD app roles assigned to the user. */
  readonly roles: readonly string[];
  /** AAD security groups the user is a member of. */
  readonly groups: readonly string[];
}

/** Handler that the adopter registers per tool name. Receives the
 *  parsed action input + identity; returns a JSON-serialisable
 *  result. The middleware wraps non-card results with the Adaptive
 *  Card response shape (ADR-042 D4) when appropriate. */
export type ConnectorActionHandler = (input: {
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  readonly identity: ConnectorIdentity;
  readonly signal: AbortSignal;
}) => Promise<ConnectorActionResult>;

/** Result shape Copilot Studio renders. `adaptiveCard` is the
 *  highest-fidelity surface; `message` is the text fallback;
 *  `data` rides along untouched for connector-native chaining. */
export interface ConnectorActionResult {
  readonly message?: string;
  readonly adaptiveCard?: object;
  readonly data?: Record<string, unknown>;
}

/** Minimal OpenAPI 3 fragment shape -- enough for what we emit. */
export interface OpenApiSchema {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  format?: string;
  description?: string;
  enum?: readonly (string | number | boolean)[];
  items?: OpenApiSchema;
  properties?: Record<string, OpenApiSchema>;
  required?: readonly string[];
  additionalProperties?: boolean;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  nullable?: boolean;
  default?: unknown;
}
