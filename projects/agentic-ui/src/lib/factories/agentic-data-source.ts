import type { DataSourceDef, DataSourceKind } from '../types/registry-defs';

export interface AgenticDataSourceConfig<TQuery, TResult> {
  readonly name: string;
  readonly kind: DataSourceKind;
  readonly adapter: (query: TQuery) => TResult;
}

export function agenticDataSource<TQuery, TResult>(
  config: AgenticDataSourceConfig<TQuery, TResult>,
): DataSourceDef {
  return {
    name: config.name,
    kind: config.kind,
    adapter: config.adapter as (query: unknown) => unknown,
  };
}

/**
 * Convenience factory for a REST source backed by `fetch`. The query object's
 * fields are URL-encoded and appended to `baseUrl` as a path or query string.
 */
export function restDataSource(name: string, baseUrl: string, fetchFn: typeof fetch = globalThis.fetch): DataSourceDef {
  return agenticDataSource({
    name,
    kind: 'rest',
    adapter: async (query: { path?: string; method?: string; body?: unknown; headers?: Record<string, string> }) => {
      const url = new URL(query.path ?? '', baseUrl).toString();
      const res = await fetchFn(url, {
        method: query.method ?? 'GET',
        headers: { 'Content-Type': 'application/json', ...(query.headers ?? {}) },
        body: query.body !== undefined ? JSON.stringify(query.body) : undefined,
      });
      if (!res.ok) throw new Error(`${name} request failed: ${res.status} ${res.statusText}`);
      return res.json();
    },
  });
}
