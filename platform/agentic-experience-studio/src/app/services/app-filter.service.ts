import { Injectable, effect, inject, signal } from '@angular/core';
import { CapabilityCatalogService } from './capability-catalog.service';
import { AuthService } from './auth.service';

/**
 * The Studio-wide "filter by application" selection. Set from the top-bar
 * selector and read by every category list (via `CapabilityGraphService
 * .membersOf`) so picking an application scopes Forms, Workflows, Decisions,
 * Pages, … to just the capabilities that application composes. `null` = show
 * all. The selection lives here (root singleton) so it persists as the author
 * moves between category lists.
 */
@Injectable({ providedIn: 'root' })
export class AppFilterService {
  private readonly catalog = inject(CapabilityCatalogService);
  private readonly auth = inject(AuthService);

  /** Applications offered in the selector. */
  readonly apps = signal<readonly { id: string; name: string }[]>([]);
  /** The selected application name, or null for "all applications". */
  readonly selected = signal<string | null>(null);

  constructor() {
    // Load the application list once the tenant is known — the service is
    // created at bootstrap (before login), when a tenant-scoped fetch is empty.
    effect(() => { if (this.auth.isAuthenticated()) this.refresh(); });
  }

  /** (Re)load the application list for the selector. */
  refresh(): void {
    this.catalog.listByKind('application').subscribe({
      next: (r) => {
        const apps = r.items.map((c) => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name));
        this.apps.set(apps);
        // Drop a stale selection if the app no longer exists.
        if (this.selected() && !apps.some((a) => a.name === this.selected())) this.selected.set(null);
      },
      error: () => { /* leave the current list */ },
    });
  }
}
