import { ChangeDetectionStrategy, Component, ElementRef, HostListener, inject, signal } from '@angular/core';
import { ComposerService, type ComposerModeSpec } from './services/composer.service';

/**
 * The topbar's "Compose with AI" affordance. Click the button → a dropdown
 * lists the six composer modes; pick one → the service fires the agent and
 * the composed widget mounts in the active route (or takes over the entire
 * shell for L5). This is the app-wide entry point that promotes the
 * previous in-page composer sandbox into a real product capability.
 */
@Component({
  selector: 'app-composer-control',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="trigger"
      [class.active]="composer.activeMode() !== null"
      [disabled]="composer.isLoading()"
      (click)="toggle()">
      <span class="spark" aria-hidden="true">✨</span>
      <span class="label">
        @if (composer.activeMode(); as m) {
          {{ m.label }}
        } @else {
          Compose with AI
        }
      </span>
      <span class="caret" aria-hidden="true">▾</span>
    </button>

    @if (open()) {
      <ul class="menu" role="menu" (click)="$event.stopPropagation()">
        @for (m of composer.modes; track m.id) {
          <li>
            <button
              type="button"
              class="item"
              [class.active]="composer.activeMode()?.id === m.id"
              (click)="pick(m)">
              <span class="tag">{{ m.tag }}</span>
              <span class="text">
                <span class="item-label">{{ m.label }}</span>
                <span class="item-desc">{{ m.description }}</span>
              </span>
            </button>
          </li>
        }
        @if (composer.activeMode() !== null) {
          <li class="divider"><span></span></li>
          <li>
            <button type="button" class="item clear" (click)="clear()">
              <span class="tag">↺</span>
              <span class="text">
                <span class="item-label">Restore default</span>
                <span class="item-desc">Drop the composition; show standard UI.</span>
              </span>
            </button>
          </li>
        }
      </ul>
    }
  `,
  styles: `
    :host { display: inline-block; position: relative; }

    .trigger {
      display: inline-flex; align-items: center; gap: 0.45rem;
      padding: 0.4rem 0.85rem;
      background: linear-gradient(135deg, var(--primary), #06b6d4);
      color: #fff;
      border: 0; border-radius: 999px;
      font: inherit; font-size: 0.85em; font-weight: 600;
      cursor: pointer;
    }
    .trigger:hover { filter: brightness(1.05); }
    .trigger:disabled { opacity: 0.7; cursor: progress; }
    .trigger.active { background: linear-gradient(135deg, #4338ca, #06b6d4); }
    .spark { font-size: 0.95em; }
    .caret { margin-left: 0.15rem; opacity: 0.85; font-size: 0.8em; }

    .menu {
      position: absolute; right: 0; top: 100%;
      margin: 0.5rem 0 0; padding: 0.35rem;
      background: var(--surface); border: 1px solid var(--border); border-radius: var(--r);
      box-shadow: 0 10px 28px rgba(15, 23, 42, 0.14);
      min-width: 280px; max-width: 340px;
      list-style: none; z-index: 20;
      display: grid; gap: 0.1rem;
    }
    .item {
      display: grid; grid-template-columns: 28px 1fr; gap: 0.55rem; align-items: center;
      width: 100%; padding: 0.5rem 0.55rem;
      background: transparent; border: 0; border-radius: var(--r-sm);
      font: inherit; text-align: left;
    }
    .item:hover { background: #f8fafc; }
    .item.active { background: #eef2ff; }
    .tag {
      display: inline-flex; align-items: center; justify-content: center;
      width: 26px; height: 22px; border-radius: 4px;
      background: var(--code-bg); color: var(--muted);
      font-size: 0.7em; font-weight: 700; letter-spacing: 0.05em;
    }
    .item.active .tag { background: #c7d2fe; color: #1e3a8a; }
    .item.clear .tag { background: #fee2e2; color: #991b1b; }
    .text { display: grid; gap: 0.05rem; min-width: 0; }
    .item-label { font-weight: 600; font-size: 0.9em; }
    .item-desc { color: var(--muted); font-size: 0.78em; }

    .divider { padding: 0.2rem 0; }
    .divider span { display: block; height: 1px; background: var(--border); }
  `,
})
export class ComposerControlComponent {
  protected readonly composer = inject(ComposerService);
  protected readonly open = signal(false);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected toggle(): void {
    this.open.update((v) => !v);
  }

  protected pick(m: ComposerModeSpec): void {
    this.composer.compose(m);
    this.open.set(false);
  }

  protected clear(): void {
    this.composer.clear();
    this.open.set(false);
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    if (!this.host.nativeElement.contains(event.target as Node)) {
      this.open.set(false);
    }
  }
}
