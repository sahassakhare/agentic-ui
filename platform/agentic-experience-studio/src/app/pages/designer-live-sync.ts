import { effect } from '@angular/core';
import { lastMutation } from '../copilot/authoring-bridge';

/**
 * Wire the two bits of reactivity every capability designer needs. MUST be
 * called from a designer's constructor (an injection context).
 *
 * 1. **Reload on routed id change.** Angular REUSES a designer component across
 *    `/<kind>s/:id/design` → `/<kind>s/:otherId/design` (only the param changes),
 *    so a constructor-only load leaves the previous capability's state on screen.
 *    This reloads whenever the `id` input changes — the fix for "the copilot
 *    created/opened another capability but the designer still shows the old one".
 *
 * 2. **Live-refresh on a copilot edit.** The authoring copilot writes the catalog
 *    out-of-band (it has no handle on the open designer's in-memory state). When
 *    it creates/updates the capability THIS designer is showing, reload so the
 *    change appears without a manual refresh — unless the author has unsaved
 *    edits, in which case we leave their work untouched rather than clobber it.
 *
 * @param id     read the designer's routed id (signal getter)
 * @param reload re-fetch + rebind from the catalog (the designer's own reload)
 * @param isDirty whether the author has unsaved edits right now
 */
export function wireDesignerLiveSync(opts: {
  id: () => string;
  reload: () => void;
  isDirty: () => boolean;
}): void {
  let seenAt = 0;

  effect(() => {
    opts.id(); // track the routed id
    queueMicrotask(() => opts.reload());
  });

  effect(() => {
    const m = lastMutation();
    if (!m || m.at === seenAt || m.id !== opts.id()) {
      if (m) seenAt = m.at; // ignore mutations to other capabilities
      return;
    }
    seenAt = m.at;
    if (!opts.isDirty()) queueMicrotask(() => opts.reload());
    // dirty → skip: don't discard the author's unsaved edits behind their back.
  });
}
