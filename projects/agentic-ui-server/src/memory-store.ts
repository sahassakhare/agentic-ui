import type { Message } from '@ag-ui/core';

/** Minimal thread-message store, keyed by `threadId`. Replace with a DB-backed adapter for production. */
export interface ThreadStore {
  load(threadId: string): Promise<readonly Message[]>;
  save(threadId: string, messages: readonly Message[]): Promise<void>;
  append(threadId: string, messages: readonly Message[]): Promise<void>;
  clear(threadId: string): Promise<void>;
}

export class InMemoryThreadStore implements ThreadStore {
  private readonly threads = new Map<string, Message[]>();

  async load(threadId: string): Promise<readonly Message[]> {
    return this.threads.get(threadId) ?? [];
  }

  async save(threadId: string, messages: readonly Message[]): Promise<void> {
    this.threads.set(threadId, [...messages]);
  }

  async append(threadId: string, messages: readonly Message[]): Promise<void> {
    const existing = this.threads.get(threadId) ?? [];
    this.threads.set(threadId, [...existing, ...messages]);
  }

  async clear(threadId: string): Promise<void> {
    this.threads.delete(threadId);
  }
}
