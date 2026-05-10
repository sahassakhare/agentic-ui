import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  CatalogClientService,
  type Capability,
  type MfeRemote,
} from './catalog-client.service';

/**
 * Shared topology data layer for the tree view (`TopologyComponent`)
 * and the graph view (`TopologyGraphComponent`). Both views render
 * the same fetched data; centralising it here avoids duplicate
 * pagination loops and lets the SSE refresh fire once for both.
 */
@Injectable({ providedIn: 'root' })
export class TopologyDataService {
  private readonly catalog = inject(CatalogClientService);

  readonly capabilities = signal<readonly Capability[]>([]);
  readonly mfes = signal<readonly MfeRemote[]>([]);
  readonly loading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  async refresh(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      // Page through capabilities — catalog limit caps at 500
      // (CapabilityListQuerySchema). Empty-page break is a safety
      // guard; normal flow exits when offset >= total.
      const PAGE = 500;
      const all: Capability[] = [];
      let offset = 0;
      let total = Number.POSITIVE_INFINITY;
      while (offset < total) {
        const page = await firstValueFrom(this.catalog.listCapabilities({ limit: PAGE, offset }));
        all.push(...page.items);
        total = page.total;
        offset += page.items.length;
        if (page.items.length === 0) break;
      }
      const mfeRes = await firstValueFrom(this.catalog.listMfes());
      this.capabilities.set(all);
      this.mfes.set(mfeRes.items);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.loading.set(false);
    }
  }
}
