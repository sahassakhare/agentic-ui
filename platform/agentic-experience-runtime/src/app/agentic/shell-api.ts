/**
 * A tiny bridge between the agentic tool handlers (which run inside the run-loop,
 * outside Angular DI) and the running app shell. The `App` component registers
 * its handlers on init; tools call them to actually drive the application —
 * so the assistant can *open apps* and *list what's available*, not just chat.
 */
export interface ShellMenuItem {
  readonly name: string;
  readonly title: string;
  readonly kind: 'dashboard' | 'experience';
}

export interface ShellApi {
  openExperience?: (name: string) => boolean;
  listMenu?: () => ShellMenuItem[];
}

/** Module-level singleton the App writes to and the tools read from. */
export const shellApi: ShellApi = {};
