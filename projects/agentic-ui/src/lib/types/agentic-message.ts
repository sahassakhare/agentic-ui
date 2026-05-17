export type AgenticMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface AgenticToolCall {
  toolCallId: string;
  name: string;
  args: unknown;
  result?: unknown;
  error?: { code: string; message: string };
}

export interface AgenticWidgetInstance {
  widgetCallId: string;
  name: string;
  props: unknown;
}

/**
 * Multi-part message content (Capability F6 — r3 plan §9.6.3).
 *
 * Mirrors Anthropic / OpenAI / Gemini conventions for multi-modal
 * input. Backends that advertise `BackendCapabilities.multiModal =
 * true` consume this directly; backends without multi-modal support
 * either text-only fallback (with a warning) or refuse the message.
 */
export type MessageContent =
  | { readonly kind: 'text'; readonly text: string }
  | {
      readonly kind: 'image';
      /** MIME type, e.g. `image/png`, `image/jpeg`. */
      readonly mimeType: string;
      /**
       * Image bytes — either an `ArrayBuffer` (in-memory) or a base64
       * data-URI / signed URL (if pre-uploaded). Adapters translate
       * to the backend's wire shape.
       */
      readonly data: ArrayBuffer | string;
      /** Optional alt text / human-readable caption. */
      readonly alt?: string;
    }
  | {
      readonly kind: 'file';
      readonly mimeType: string;
      readonly filename: string;
      /** Server-stored URI (signed URL from `agUiUploadHandler` or equivalent). */
      readonly uri: string;
      /** Optional original size in bytes — for transcript display. */
      readonly sizeBytes?: number;
    };

export interface AgenticMessage {
  id: string;
  role: AgenticMessageRole;
  /**
   * Message body. `string` is the legacy / single-part shape; the
   * `MessageContent[]` shape carries multi-modal parts (Capability F6).
   * Renderers and adapters MUST handle both branches.
   */
  content: string | readonly MessageContent[];
  toolCalls: readonly AgenticToolCall[];
  widgets: readonly AgenticWidgetInstance[];
}
