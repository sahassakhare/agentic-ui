/**
 * Reusable **shell components** — the building blocks of a master page. Each is a
 * normal registry component, so it can be dropped into any master-page region (or
 * even a page) and configured with props. They inject app state (nav, identity)
 * as needed, so a designed shell is assembled entirely from these + your own
 * components. This is what makes the master page fully composable: logo, sidenav,
 * header, footer and the assistant are all just components in regions.
 */
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { ChatShellComponent } from '@infra-tools/agentic-ui';
import { z } from 'zod';
import { agenticWidget, type ComponentDef } from '@infra-tools/agentic-ui';
import { ApplicationSource, flattenNav } from '../catalog/application-source';
import { AuthService } from '../auth/auth.service';

/** Brand logo — an image (`src`) or a mark + text. */
@Component({
  selector: 'shell-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (src()) { <img class="img" [src]="src()" [alt]="text() || 'logo'" /> }
    @else { <span class="logo"><span class="mk">{{ mark() || '◆' }}</span><strong>{{ text() || 'Brand' }}</strong></span> }
  `,
  styles: [`
    :host { display:inline-flex; align-items:center; }
    .img { height:28px; width:auto; display:block; }
    .logo { display:inline-flex; align-items:center; gap:9px; font-size:15px; }
    .mk { display:grid; place-items:center; width:30px; height:30px; border-radius:8px; background:rgba(103,80,164,.14); color:#6750a4; }
  `],
})
export class LogoWidget {
  readonly src = input<string>();
  readonly text = input<string>();
  readonly mark = input<string>();
}

/** The sidenav control — renders the application's persona-filtered route tree. */
@Component({
  selector: 'shell-sidenav',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive],
  template: `
    @if (title()) { <div class="eyebrow">{{ title() }}</div> }
    <nav>
      @for (n of nav(); track n.fullPath) {
        <a class="item" [class.child]="n.depth > 0" [style.paddingLeft.px]="11 + n.depth * 16"
           [routerLink]="'/' + n.fullPath" routerLinkActive="on" [routerLinkActiveOptions]="{ exact: true }">
          <span class="ic">{{ n.depth > 0 ? '·' : '›' }}</span><span class="nm">{{ n.title }}</span>
        </a>
      } @empty { <p class="muted">No pages.</p> }
    </nav>
  `,
  styles: [`
    :host { display:block; }
    .eyebrow { font-size:11px; text-transform:uppercase; letter-spacing:.07em; opacity:.5; margin:0 0 10px; }
    nav { display:flex; flex-direction:column; gap:5px; }
    .item { display:flex; align-items:center; gap:10px; padding:9px 11px; border-radius:9px; text-decoration:none; color:inherit; border:1px solid transparent; }
    .item:hover { background:rgba(120,120,140,.08); }
    .item.on { background:rgba(103,80,164,.12); border-color:rgba(103,80,164,.35); }
    .item.child { opacity:.85; } .ic { opacity:.6; width:14px; } .nm { font-size:13.5px; font-weight:600; }
    .muted { opacity:.5; font-size:12.5px; }
  `],
})
export class SidenavWidget {
  private readonly app = inject(ApplicationSource);
  private readonly auth = inject(AuthService);
  readonly title = input<string>();
  protected readonly nav = computed(() => flattenNav(this.app.navFor(this.auth.persona())));
}

/**
 * Enterprise header bar — module title + optional breadcrumb/subtitle, a global
 * search box, a notifications bell (with count), a help link, and a user menu
 * (avatar + name + role + sign-out). Every element is prop-configurable so the
 * same component serves any application's header. Emits searches to the console
 * hook (a real app would route them); the user menu toggles inline.
 */
@Component({
  selector: 'shell-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="hdr">
      <div class="lead">
        <span class="ttl">{{ title() || app.title() }}</span>
        @if (subtitle()) { <span class="crumb">{{ subtitle() }}</span> }
      </div>

      @if (showSearch() !== false) {
        <label class="search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.7"/><path d="m20 20-3.2-3.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
          <input [placeholder]="searchPlaceholder() || 'Search…'" [(ngModel)]="query" (keyup.enter)="runSearch()" />
        </label>
      }

      <span class="sp"></span>

      @if (showNotifications() !== false) {
        <button class="ic" title="Notifications" (click)="bell()">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M6 9a6 6 0 1 1 12 0c0 4 1.5 5 2 6H4c.5-1 2-2 2-6Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M10 20a2 2 0 0 0 4 0" stroke="currentColor" stroke-width="1.6"/></svg>
          @if (notificationCount()) { <span class="badge">{{ notificationCount() }}</span> }
        </button>
      }
      @if (helpUrl()) { <a class="ic" [href]="helpUrl()" target="_blank" rel="noopener" title="Help">?</a> }

      <div class="user" (click)="menuOpen.set(!menuOpen())">
        <span class="avatar">{{ initials() }}</span>
        @if (showPersona() !== false) { <span class="uname">{{ auth.persona() }}</span> }
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        @if (menuOpen()) {
          <div class="menu" (click)="$event.stopPropagation()">
            <div class="mrow head"><span class="avatar lg">{{ initials() }}</span><div><strong>{{ userName() || auth.persona() }}</strong><span class="role">{{ auth.persona() }}</span></div></div>
            <button class="mrow" (click)="auth.logout()">Sign out</button>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display:block; flex:1; }
    .hdr { display:flex; align-items:center; gap:14px; width:100%; }
    .lead { display:flex; align-items:baseline; gap:10px; min-width:0; }
    .ttl { font-size:15px; font-weight:700; white-space:nowrap; }
    .crumb { font-size:12px; opacity:.55; white-space:nowrap; }
    .sp { flex:1; }
    .search { display:flex; align-items:center; gap:7px; padding:6px 11px; border:1px solid rgba(120,120,140,.28); border-radius:20px; min-width:200px; max-width:340px; flex:1; opacity:.9; }
    .search svg { opacity:.5; flex:none; } .search input { border:none; background:transparent; color:inherit; font:inherit; font-size:13px; width:100%; outline:none; }
    .ic { position:relative; display:grid; place-items:center; width:34px; height:34px; border-radius:9px; border:1px solid rgba(120,120,140,.22); background:transparent; color:inherit; cursor:pointer; text-decoration:none; font-size:14px; }
    .ic:hover { background:rgba(120,120,140,.08); }
    .badge { position:absolute; top:-4px; right:-4px; min-width:16px; height:16px; padding:0 4px; border-radius:9px; background:#c0392b; color:#fff; font-size:10px; line-height:16px; text-align:center; }
    .user { position:relative; display:flex; align-items:center; gap:8px; padding:4px 8px 4px 4px; border-radius:22px; border:1px solid rgba(120,120,140,.22); cursor:pointer; }
    .user:hover { background:rgba(120,120,140,.08); }
    .avatar { display:grid; place-items:center; width:28px; height:28px; border-radius:50%; background:#6750a4; color:#fff; font-size:12px; font-weight:700; } .avatar.lg { width:36px; height:36px; font-size:14px; }
    .uname { font-size:13px; font-weight:600; }
    .menu { position:absolute; top:calc(100% + 8px); right:0; min-width:210px; background:var(--surface,#fff); border:1px solid rgba(120,120,140,.2); border-radius:12px; box-shadow:0 12px 34px rgba(0,0,0,.14); padding:6px; z-index:50; }
    .mrow { display:flex; align-items:center; gap:10px; width:100%; padding:9px 10px; border:none; background:transparent; color:inherit; font:inherit; font-size:13px; text-align:left; cursor:pointer; border-radius:8px; }
    .mrow:hover { background:rgba(120,120,140,.08); } .mrow.head { cursor:default; border-bottom:1px solid rgba(120,120,140,.12); margin-bottom:4px; }
    .mrow.head .role { display:block; font-size:11px; opacity:.55; }
  `],
})
export class HeaderWidget {
  protected readonly app = inject(ApplicationSource);
  protected readonly auth = inject(AuthService);
  readonly title = input<string>();
  readonly subtitle = input<string>();
  readonly userName = input<string>();
  readonly showPersona = input<boolean>();
  readonly showSearch = input<boolean>();
  readonly searchPlaceholder = input<string>();
  readonly showNotifications = input<boolean>();
  readonly notificationCount = input<number>();
  readonly helpUrl = input<string>();

  protected readonly query = signal('');
  protected readonly menuOpen = signal(false);
  protected readonly initials = computed(() => {
    const n = this.userName() || this.auth.persona() || 'U';
    return n.split(/[\s-]+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || 'U';
  });

  protected runSearch(): void { if (this.query().trim()) console.info('[header] search:', this.query()); }
  protected bell(): void { console.info('[header] notifications'); }
}

/** A footer — text + links. */
@Component({
  selector: 'shell-footer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ft">
      <span>{{ text() }}</span>
      <span class="links">@for (l of linkList(); track l.href) { <a [href]="l.href" target="_blank" rel="noopener">{{ l.label }}</a> }</span>
    </div>
  `,
  styles: [`
    :host { display:block; width:100%; }
    .ft { display:flex; align-items:center; gap:16px; font-size:12px; opacity:.72; }
    .links { margin-left:auto; display:flex; gap:16px; } .links a { color:inherit; text-decoration:none; } .links a:hover { text-decoration:underline; }
  `],
})
export class FooterWidget {
  readonly text = input<string>();
  readonly links = input<unknown>();
  protected readonly linkList = computed(() => {
    const v = this.links();
    return (Array.isArray(v) ? v : []) as { label: string; href: string }[];
  });
}

/** The AI assistant control — wraps the agentic chat shell so it can sit in a region. */
@Component({
  selector: 'shell-assistant',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChatShellComponent],
  template: `
    <div class="head"><span class="dot"></span> {{ title() || 'Assistant' }} <span class="sub">agent · ag-ui</span></div>
    <mvk-chat-shell mode="rail" [placeholder]="placeholder() || 'Ask the assistant…'" />
  `,
  styles: [`
    :host { display:flex; flex-direction:column; min-height:0; height:100%; }
    .head { display:flex; align-items:center; gap:8px; padding:12px 4px; font-size:13px; font-weight:600; border-bottom:1px solid rgba(120,120,140,.14); }
    .head .dot { width:8px; height:8px; border-radius:50%; background:#0a7d32; } .head .sub { margin-left:auto; font-size:11px; font-weight:400; opacity:.5; }
    mvk-chat-shell { flex:1; min-height:0; display:block; }
  `],
})
export class AssistantWidget {
  readonly title = input<string>();
  readonly placeholder = input<string>();
}

// ── Registration ────────────────────────────────────────────────────────────
const anyProps = z.object({}).passthrough();
const w = (name: string, component: unknown): ComponentDef =>
  agenticWidget({ name, component: component as never, propsSchema: anyProps });

/** Shell components registered into ComponentRegistry (droppable into master regions). */
export const shellWidgets: readonly ComponentDef[] = [
  w('app-logo', LogoWidget),
  w('app-sidenav', SidenavWidget),
  w('app-header', HeaderWidget),
  w('app-footer', FooterWidget),
  w('app-assistant', AssistantWidget),
];

/** Names + categories for designers (so the palette can group "Shell" components). */
export const SHELL_COMPONENT_NAMES = ['app-logo', 'app-sidenav', 'app-header', 'app-footer', 'app-assistant'] as const;
