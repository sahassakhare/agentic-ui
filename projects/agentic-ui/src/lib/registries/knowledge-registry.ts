import { Injectable } from '@angular/core';
import { RegistryBase } from './registry-base';
import type { KnowledgeDef } from '../types/registry-defs';

/**
 * Registry of knowledge-source metadata (RAG corpora, document/SQL/graph/API
 * stores) — AEP Seam B. Metadata only; retrieval stays adapter-side so no
 * search engine lands in the runtime bundle (runtime non-goals).
 */
@Injectable({ providedIn: 'root' })
export class KnowledgeRegistry extends RegistryBase<KnowledgeDef> {
  protected readonly registryName = 'knowledge';

  /** Knowledge sources of a given kind ('vector', 'document', …). */
  byKind(kind: string): readonly KnowledgeDef[] {
    return this.list().filter((k) => k.kind === kind);
  }
}
