import {
  ChangeDetectionStrategy,
  Component,
  HostBinding,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  BackendRegistry,
  injectAgenticChat,
  type AgenticChatRef,
  type MessageContent,
} from '../internal';
import {
  ChatShellMode,
  CHAT_SHELL_MODES,
  LAYOUT_POLICY,
} from '../layout/types';
import { WidgetContainerComponent } from './widget-container.component';

/**
 * Per-attachment record held in the composer's pending tray (Capability F6).
 * Materialises on the user's local browser between drag/drop / paste / file-
 * picker and Send. Each entry carries the original `File` plus a generated
 * preview / data URI so the user sees what they're about to send.
 */
interface PendingAttachment {
  readonly id: string;
  readonly file: File;
  /** `'image' | 'file'` — drives the preview affordance. */
  readonly kind: 'image' | 'file';
  /** Data-URI for image previews; undefined for non-image files. */
  readonly previewUri?: string;
}

/**
 * Default MIME allow-list for the composer (Capability F6, AC-F6-5).
 * Hosts override via the `acceptedMimeTypes` input. PDF + common images +
 * Word/Excel are the demo defaults; everything else is rejected client-side
 * with a user-visible error.
 */
const DEFAULT_ACCEPTED_MIME = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;

/** Default per-file size cap (Capability F6, AC-F6-5). 10 MB. */
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

@Component({
  selector: 'mvk-chat-shell',
  imports: [FormsModule, WidgetContainerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: flex; flex-direction: column; height: 100%; min-height: 0; font-family: system-ui, sans-serif; }
    .transcript { flex: 1; overflow-y: auto; padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem; }
    .transcript[data-dragging="true"] { background: #eef2ff; outline: 2px dashed #6366f1; outline-offset: -8px; }
    .msg { max-width: 80%; padding: 0.6rem 0.8rem; border-radius: 0.6rem; line-height: 1.4; white-space: pre-wrap; }
    .msg.user { align-self: flex-end; background: #2563eb; color: white; }
    .msg.assistant { align-self: flex-start; background: #f3f4f6; color: #111827; }
    .msg.system { align-self: center; background: #fee2e2; color: #991b1b; font-size: 0.85em; }
    .msg.tool { align-self: flex-start; background: #ecfeff; color: #155e75; font-family: ui-monospace, monospace; font-size: 0.85em; }
    .widgets { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.5rem; }
    .msg .parts { display: flex; flex-direction: column; gap: 0.4rem; }
    .msg .image-part img { max-width: 240px; max-height: 240px; border-radius: 0.4rem; display: block; }
    .msg .file-part { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.3rem 0.5rem; background: rgba(255, 255, 255, 0.18); border-radius: 0.3rem; font-size: 0.85em; color: inherit; text-decoration: none; }
    .msg.assistant .file-part { background: #e0e7ff; color: #3730a3; }
    .composer-wrap { border-top: 1px solid #e5e7eb; padding: 0.75rem; display: flex; flex-direction: column; gap: 0.5rem; }
    .pending { display: flex; flex-wrap: wrap; gap: 0.4rem; }
    .pending-item { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.3rem 0.5rem; background: #f3f4f6; border: 1px solid #d1d5db; border-radius: 0.3rem; font-size: 0.85em; max-width: 240px; }
    .pending-item img { width: 28px; height: 28px; object-fit: cover; border-radius: 0.2rem; }
    .pending-item .name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pending-item button { background: transparent; border: 0; color: #6b7280; cursor: pointer; padding: 0; font-size: 1rem; line-height: 1; }
    .composer { display: flex; gap: 0.5rem; align-items: stretch; }
    .composer input.text { flex: 1; padding: 0.6rem 0.8rem; border: 1px solid #d1d5db; border-radius: 0.4rem; font: inherit; }
    .composer button.send { padding: 0.6rem 1.1rem; background: #2563eb; color: white; border: 0; border-radius: 0.4rem; font-weight: 600; cursor: pointer; }
    .composer button.send:disabled { opacity: 0.5; cursor: not-allowed; }
    .composer .icon-btn { padding: 0.4rem 0.7rem; background: #f3f4f6; color: #4b5563; border: 1px solid #d1d5db; border-radius: 0.4rem; cursor: pointer; font: inherit; }
    .composer .icon-btn:hover { background: #e5e7eb; }
    .composer .icon-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .composer-error { padding: 0.4rem 0.6rem; background: #fee2e2; color: #991b1b; border-radius: 0.3rem; font-size: 0.8em; }
    .header { display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 1rem; border-bottom: 1px solid #e5e7eb; font-size: 0.85em; color: #6b7280; }
    .backend-pill { padding: 0.15rem 0.5rem; border-radius: 999px; background: #eef2ff; color: #4338ca; font-weight: 600; }
    .error { background: #fee2e2; color: #991b1b; padding: 0.5rem 1rem; font-size: 0.85em; }
  `,
  template: `
    <div class="header">
      <span>Agentic chat</span>
      @if (activeBackend(); as b) {
        <span class="backend-pill">{{ b.label }}</span>
      } @else {
        <span class="backend-pill" style="background:#fee2e2;color:#991b1b">no backend</span>
      }
    </div>

    @if (chat.error(); as err) {
      <div class="error">{{ err.message }}</div>
    }

    <div class="transcript"
         [attr.data-dragging]="isDragging()"
         (dragover)="onDragOver($event)"
         (dragleave)="onDragLeave($event)"
         (drop)="onDrop($event)"
         (paste)="onPaste($event)">
      @for (m of chat.value(); track m.id) {
        <div class="msg" [class]="m.role">
          @if (isStringContent(m.content)) {
            @if (m.content) { {{ m.content }} }
          } @else {
            <div class="parts">
              @for (p of contentParts(m.content); track $index) {
                @switch (p.kind) {
                  @case ('text') { @if (p.text) { <span>{{ p.text }}</span> } }
                  @case ('image') {
                    <span class="image-part">
                      <img [src]="imagePreview(p)" [alt]="p.alt ?? '(image)'" />
                    </span>
                  }
                  @case ('file') {
                    <a class="file-part" [href]="p.uri" target="_blank" rel="noopener">
                      📎 {{ p.filename }}
                    </a>
                  }
                }
              }
            </div>
          }
          @for (tc of m.toolCalls; track tc.toolCallId) {
            @if (showToolCalls() !== 'hidden') {
              <div class="msg tool" style="margin-top:0.4rem">
                @switch (showToolCalls()) {
                  @case ('compact') {
                    → {{ tc.name }}
                    @if (tc.error) { ✗ {{ tc.error.message }} }
                  }
                  @default {
                    → {{ tc.name }}({{ stringify(tc.args) }})
                    @if (tc.result !== undefined) { ⇒ {{ stringify(tc.result) }} }
                    @if (tc.error) { ✗ {{ tc.error.message }} }
                  }
                }
              </div>
            }
          }
          @if (m.widgets.length) {
            <div class="widgets">
              @for (w of m.widgets; track w.widgetCallId) {
                <mvk-widget-container [widget]="w" />
              }
            </div>
          }
        </div>
      }
      @if (chat.isLoading()) {
        <div class="msg assistant">…</div>
      }
    </div>

    <div class="composer-wrap">
      @if (composerError(); as err) {
        <div class="composer-error" role="alert">{{ err }}</div>
      }
      @if (pending().length > 0) {
        <div class="pending" aria-label="Pending attachments">
          @for (att of pending(); track att.id) {
            <span class="pending-item">
              @if (att.previewUri) { <img [src]="att.previewUri" alt="" /> }
              @else { <span aria-hidden="true">📎</span> }
              <span class="name" [title]="att.file.name">{{ att.file.name }}</span>
              <button type="button" (click)="removeAttachment(att.id)" aria-label="Remove">×</button>
            </span>
          }
        </div>
      }
      <form class="composer" (ngSubmit)="onSubmit()">
        <button
          type="button"
          class="icon-btn"
          (click)="filePicker.click()"
          [disabled]="chat.isLoading()"
          aria-label="Attach file"
          title="Attach file"
        >📎</button>
        <input #filePicker
               type="file"
               multiple
               style="display:none"
               [accept]="acceptedMimeTypes().join(',')"
               (change)="onFilesPicked($event)" />
        <input
          class="text"
          [(ngModel)]="draft"
          name="composer"
          [placeholder]="placeholder()"
          [disabled]="chat.isLoading()"
          autocomplete="off"
        />
        <button type="submit" class="send"
                [disabled]="chat.isLoading() || (!draft().trim() && pending().length === 0)">
          Send
        </button>
      </form>
    </div>
  `,
})
export class ChatShellComponent {
  readonly placeholder = input<string>('Ask the agent…');
  readonly maxLocalTurns = input<number>(10);

  /**
   * Presentation mode for the chat shell (ADR-043 D2).
   *
   * - `'rail'` *(default)* — persistent right rail, ~360px. Back-compat
   *   with every existing `<mvk-chat-shell />` consumer.
   * - `'pill'` — floating corner pill, expands on click. For inspector-
   *   first routes (doc review, canvas work) where the work is foreground.
   * - `'overlay'` — full-screen transient overlay; dismissible.
   * - `'docked-bottom'` — sticky ~120px strip at the bottom; for glance-
   *   driven dashboards where proactive alerts surface without competing.
   * - `'assist-panel'` — Cursor-style structured-affordance panel (next
   *   actions, explain-on-cursor, scoped query). Pairs with the
   *   `<mvk-assist-panel>` component arriving in P1.
   * - `'hidden'` — chat is the wrong primitive (Audit, query-bar routes).
   *
   * Apps that wire `provideLayoutPolicy({...})` get this resolved per
   * route + persona via the `LAYOUT_POLICY` token — bind via
   * `[mode]="layoutPolicy.shellMode(router.url)"`. Apps that pass `mode`
   * explicitly override the policy.
   *
   * @default the `LAYOUT_POLICY.shellMode('/')` result, which defaults
   *   to `'rail'` when no policy is provided.
   *
   * @see [ADR-043](../../../../docs/adr/0043-layout-registry-promotion.md)
   */
  readonly mode = input<ChatShellMode | undefined>(undefined);

  private readonly layoutPolicy = inject(LAYOUT_POLICY);

  /**
   * Effective mode used to render the shell. Honours the explicit `[mode]`
   * input when set; otherwise consults the active persona's `LayoutPolicy`.
   * Falls back to `'rail'` when neither resolves.
   */
  readonly effectiveMode = computed<ChatShellMode>(() => {
    const explicit = this.mode();
    if (explicit && CHAT_SHELL_MODES.includes(explicit)) {
      return explicit;
    }
    try {
      const fromPolicy = this.layoutPolicy.shellMode('/');
      if (CHAT_SHELL_MODES.includes(fromPolicy)) {
        return fromPolicy;
      }
    } catch {
      // Policy resolution shouldn't throw, but if it does, fall through to
      // rail mode so the shell never fails to render.
    }
    return 'rail';
  });

  /**
   * Mirror `effectiveMode` onto the host element as `data-mode="..."` so
   * apps and themes can style by mode without piercing the component
   * (e.g. `mvk-chat-shell[data-mode="pill"] { ... }`).
   */
  @HostBinding('attr.data-mode')
  get hostMode(): ChatShellMode {
    return this.effectiveMode();
  }

  /**
   * Controls how tool calls render inside the assistant message bubble.
   *
   *  - `'full'` *(default)* — emits `→ name(args) ⇒ result` with both the
   *    args and the result serialised to JSON. Useful for debugging
   *    handler shapes; can clutter the transcript when results carry
   *    bulky payloads or render through generative-UI widgets.
   *  - `'compact'` — emits just `→ name` (plus an `✗ error` line on
   *    failure). The widget below the bubble is the visible result.
   *  - `'hidden'` — suppresses the tool-call block entirely. Use when
   *    every tool result has a corresponding widget and the agent
   *    summarises in text.
   *
   * @default 'full'
   */
  readonly showToolCalls = input<'full' | 'compact' | 'hidden'>('full');

  /**
   * MIME types the composer accepts via paperclip / drag-drop / paste
   * (Capability F6, AC-F6-5). Files outside the list are rejected
   * client-side with a user-visible error.
   *
   * @default ['application/pdf', 'image/*' (+ common subtypes), 'application/vnd.openxmlformats-officedocument.*']
   */
  readonly acceptedMimeTypes = input<readonly string[]>(DEFAULT_ACCEPTED_MIME);

  /**
   * Per-file size cap in bytes (Capability F6, AC-F6-5). Uploads above
   * the cap are rejected client-side. Default 10 MB.
   */
  readonly maxBytes = input<number>(DEFAULT_MAX_BYTES);

  protected readonly chat: AgenticChatRef = injectAgenticChat({ maxLocalTurns: this.maxLocalTurns() });
  protected readonly draft = signal<string>('');
  protected readonly pending = signal<readonly PendingAttachment[]>([]);
  protected readonly composerError = signal<string | null>(null);
  protected readonly isDragging = signal<boolean>(false);

  private readonly backends = inject(BackendRegistry);
  protected readonly activeBackend = computed(() => this.backends.active());

  /**
   * Programmatically send a text prompt as if the user typed and submitted it.
   * Lets the host page wire suggestion chips, "try-asking" lists, demo
   * scripts, etc. Same path as `onSubmit` for the text-only case — does not
   * touch any pending attachments.
   */
  sendMessage(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.chat.sendMessage(trimmed);
    this.draft.set('');
  }

  protected onSubmit(): void {
    const text = this.draft().trim();
    const atts = this.pending();
    if (!text && atts.length === 0) return;
    if (atts.length === 0) {
      this.chat.sendMessage(text);
      this.draft.set('');
      return;
    }
    // Multi-modal path. Build MessageContent[] from the pending
    // attachments + draft text. File / image data is read into base64
    // data URIs for v1 — production deployments swap to the
    // server-uploaded `uri` shape via `agUiUploadHandler`.
    void this.buildMultiModalAndSend(text, atts);
  }

  private async buildMultiModalAndSend(text: string, atts: readonly PendingAttachment[]): Promise<void> {
    const parts: MessageContent[] = [];
    if (text) parts.push({ kind: 'text', text });
    for (const att of atts) {
      try {
        const dataUri = await readFileAsDataUri(att.file);
        if (att.kind === 'image') {
          parts.push({
            kind: 'image',
            mimeType: att.file.type || 'image/png',
            data: dataUri,
            alt: att.file.name,
          });
        } else {
          parts.push({
            kind: 'file',
            mimeType: att.file.type || 'application/octet-stream',
            filename: att.file.name,
            uri: dataUri,
            sizeBytes: att.file.size,
          });
        }
      } catch (err) {
        this.composerError.set(`Failed to read ${att.file.name}: ${describe(err)}`);
        return;
      }
    }
    this.chat.sendMessage(parts);
    this.draft.set('');
    this.pending.set([]);
    this.composerError.set(null);
  }

  protected onFilesPicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input.files ? Array.from(input.files) : [];
    void this.acceptFiles(files);
    input.value = ''; // allow re-picking the same file
  }

  protected onDragOver(event: DragEvent): void {
    if (!event.dataTransfer) return;
    if (Array.from(event.dataTransfer.types).includes('Files')) {
      event.preventDefault();
      this.isDragging.set(true);
    }
  }

  protected onDragLeave(event: DragEvent): void {
    if ((event.currentTarget as HTMLElement | null)?.contains(event.relatedTarget as Node | null)) {
      return;
    }
    this.isDragging.set(false);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(false);
    const files = event.dataTransfer?.files ? Array.from(event.dataTransfer.files) : [];
    if (files.length > 0) void this.acceptFiles(files);
  }

  protected onPaste(event: ClipboardEvent): void {
    const items = event.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) void this.acceptFiles(files);
  }

  protected removeAttachment(id: string): void {
    this.pending.update((cur) => cur.filter((p) => p.id !== id));
  }

  private async acceptFiles(files: readonly File[]): Promise<void> {
    const accepted = this.acceptedMimeTypes();
    const cap = this.maxBytes();
    const additions: PendingAttachment[] = [];
    for (const f of files) {
      if (f.size > cap) {
        this.composerError.set(
          `${f.name} is ${formatSize(f.size)} — over the ${formatSize(cap)} per-file cap.`,
        );
        return;
      }
      if (!isMimeAccepted(f.type, accepted)) {
        this.composerError.set(
          `${f.name}: type "${f.type || 'unknown'}" not in the accepted list.`,
        );
        return;
      }
      const isImage = (f.type || '').startsWith('image/');
      let previewUri: string | undefined;
      if (isImage) {
        try { previewUri = await readFileAsDataUri(f); } catch { /* ignore */ }
      }
      additions.push({
        id: `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        file: f,
        kind: isImage ? 'image' : 'file',
        previewUri,
      });
    }
    this.pending.update((cur) => [...cur, ...additions]);
    this.composerError.set(null);
  }

  // ── Transcript rendering helpers ──────────────────────────────────────

  protected isStringContent(content: unknown): content is string {
    return typeof content === 'string';
  }

  protected contentParts(content: unknown): readonly MessageContent[] {
    return Array.isArray(content) ? (content as readonly MessageContent[]) : [];
  }

  /** Resolve an image part's `data` (ArrayBuffer | string) to a renderable src. */
  protected imagePreview(part: { mimeType: string; data: ArrayBuffer | string }): string {
    if (typeof part.data === 'string') return part.data;
    // ArrayBuffer → data URI on demand. Cached per ArrayBuffer reference.
    const cached = this.bufferUris.get(part.data);
    if (cached) return cached;
    const blob = new Blob([part.data], { type: part.mimeType });
    const uri = URL.createObjectURL(blob);
    this.bufferUris.set(part.data, uri);
    return uri;
  }

  private readonly bufferUris = new WeakMap<ArrayBuffer, string>();

  protected stringify(value: unknown): string {
    try { return typeof value === 'string' ? value : JSON.stringify(value); } catch { return String(value); }
  }
}

// ─── Local helpers ─────────────────────────────────────────────────────────

function readFileAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result;
      if (typeof r === 'string') resolve(r);
      else reject(new Error('FileReader returned non-string result'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsDataURL(file);
  });
}

function isMimeAccepted(mime: string, allowed: readonly string[]): boolean {
  if (!mime) return false;
  for (const a of allowed) {
    if (a === mime) return true;
    if (a.endsWith('/*')) {
      const prefix = a.slice(0, -1);
      if (mime.startsWith(prefix)) return true;
    }
  }
  return false;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
