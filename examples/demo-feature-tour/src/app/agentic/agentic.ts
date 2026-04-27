import { EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { Router } from '@angular/router';
import {
  ActionRegistry,
  DataSourceRegistry,
  FormRegistry,
  IntentRegistry,
  agenticAction,
  agenticForm,
  agenticIntent,
  agenticTool,
  agenticWidget,
  restDataSource,
  type ActionDef,
  type ComponentDef,
  type FormDef,
  type ToolDef,
} from '@maverick/agentic-ui';
import { z } from 'zod';
import { ProfileService } from '../services/profile.service';
import { ToastService } from '../services/toast.service';
import { FormCardComponent } from './form-card.component';
import { NavConfirmationComponent } from './nav-confirmation.component';
import { UserInfoCardComponent } from './user-info-card.component';

/**
 * Pulls together the four "extended" registries this demo highlights:
 *
 * - `ActionRegistry` — `navigate`, `showToast`. Dispatched by tools below.
 * - `FormRegistry` — `profileForm`, rendered by `<mvk-form-renderer>`.
 * - `DataSourceRegistry` — `users`, a `restDataSource` wrapping `fetch`.
 * - `IntentRegistry` — `goHomeIntent`, illustrative pre-LLM router.
 *
 * Called from `app.config.ts` via `provideEnvironmentInitializer` so the
 * registries are populated before the chat shell renders.
 */
export function registerExtendedCapabilities(env: EnvironmentInjector): void {
  // ── Actions ────────────────────────────────────────────────────────────
  // Each effect is wrapped in `runInInjectionContext(env, …)` so it can
  // reach Router / ToastService / ProfileService — i.e., your existing
  // app services. Anyone can dispatch these via `ActionRegistry.get(type)
  // .effect(payload, ctx)` — tools, A2UI events, or hand-rolled buttons.
  const actions = env.get(ActionRegistry);
  actions.register(
    agenticAction({
      type: 'navigate',
      description: 'Navigate the user to a route path.',
      payloadSchema: z.object({
        path: z.string().describe('Route path (e.g. "/dashboard")'),
      }),
      effect: ({ path }) => {
        runInInjectionContext(env, () => env.get(Router).navigateByUrl(path));
      },
    }) as ActionDef,
  );
  actions.register(
    agenticAction({
      type: 'showToast',
      description: 'Show a transient toast notification.',
      payloadSchema: z.object({
        message: z.string(),
        level: z.enum(['info', 'success', 'warn']).default('info'),
      }),
      effect: ({ message, level }) => {
        runInInjectionContext(env, () => env.get(ToastService).show(message, level));
      },
    }) as ActionDef,
  );

  // ── Forms ──────────────────────────────────────────────────────────────
  // `<mvk-form-renderer formName="profileForm">` (used inside FormCard
  // below) resolves this entry, builds a UI from `fieldsSchema`, and
  // calls `submit` when the user clicks the button.
  env.get(FormRegistry).register(
    agenticForm({
      name: 'profileForm',
      description: 'Edit your profile.',
      fieldsSchema: z.object({
        fullName: z.string().min(1).describe('Full name'),
        email: z.string().email().describe('Email address'),
        newsletter: z.boolean().default(false).describe('Subscribe to newsletter'),
      }),
      ui: {
        fullName: { order: 1, placeholder: 'Jane Doe' },
        email: { order: 2, placeholder: 'jane@example.com' },
        newsletter: { order: 3, widget: 'checkbox' },
      },
      submit: async (values) => {
        runInInjectionContext(env, () => {
          env.get(ProfileService).update(values);
          env.get(ToastService).show('Profile updated.', 'success');
          env.get(Router).navigateByUrl('/profile');
        });
      },
    }) as FormDef,
  );

  // ── Data sources ───────────────────────────────────────────────────────
  // `restDataSource` wraps `fetch`. We pass a mock `fetch` here so the
  // demo runs without a backend; in a real app, omit the third arg and
  // it will use `globalThis.fetch`.
  env.get(DataSourceRegistry).register(restDataSource('users', 'https://api.example.com/users/', mockUsersFetch));

  // ── Intents (illustrative) ─────────────────────────────────────────────
  // Intents are pre-LLM short-circuit hints. The chat shell does NOT
  // auto-consult `IntentRegistry` — a consumer wires this in their input
  // pipeline. We register one so it's discoverable in the registry's
  // signal, and the cookbook shows how to consume it.
  env.get(IntentRegistry).register(
    agenticIntent({
      id: 'goHomeIntent',
      description: 'Navigates the user to the home route.',
      examples: ['take me home', 'go home', 'home', 'show home page'],
      schema: z.object({}),
      mapsTo: { kind: 'route', target: '/' },
    }),
  );
}

// ─── Tools the agent can call ─────────────────────────────────────────────
// Each tool is constructed by a factory so it can capture the
// `EnvironmentInjector` at registration time. Inside the handler we
// dispatch through whichever registry actually owns the work — tools
// stay thin "decide WHEN to do X" code while the registries own
// "decide HOW to do X."

export function buildTools(env: EnvironmentInjector): ToolDef[] {
  return [
    navigateTool(env) as ToolDef,
    toastTool(env) as ToolDef,
    lookupUserTool(env) as ToolDef,
    editProfileTool() as ToolDef,
  ];
}

function navigateTool(env: EnvironmentInjector) {
  return agenticTool({
    name: 'navigateTo',
    description: 'Navigate the user to a known route. Use when the user asks to go to a page (e.g., "show me the dashboard").',
    schema: z.object({
      destination: z.enum(['/', '/dashboard', '/profile']).describe('Route path to navigate to'),
    }),
    handler: async ({ destination }, ctx) => {
      const action = env.get(ActionRegistry).get('navigate');
      await action?.effect({ path: destination }, { ...ctx, actionId: ctx.toolCallId });
      return {
        ok: true,
        navigatedTo: destination,
        components: [{ name: 'navConfirmation', props: { destination } }],
      };
    },
  });
}

function toastTool(env: EnvironmentInjector) {
  return agenticTool({
    name: 'showToast',
    description: 'Show a toast notification (success / info / warn). Use for short confirmations.',
    schema: z.object({
      message: z.string(),
      level: z.enum(['info', 'success', 'warn']).default('info'),
    }),
    handler: async ({ message, level }, ctx) => {
      const action = env.get(ActionRegistry).get('showToast');
      await action?.effect({ message, level }, { ...ctx, actionId: ctx.toolCallId });
      return { ok: true };
    },
  });
}

function lookupUserTool(env: EnvironmentInjector) {
  return agenticTool({
    name: 'lookupUser',
    description: 'Look up information about a user by id (e.g. "U-1042"). Use when the user asks about a specific user.',
    schema: z.object({
      userId: z.string().describe('User id, e.g. U-1042'),
    }),
    handler: async ({ userId }) => {
      const ds = env.get(DataSourceRegistry).get('users');
      const result = (await ds!.adapter({ path: userId })) as Record<string, unknown>;
      return {
        ...result,
        components: [{ name: 'userInfoCard', props: result }],
      };
    },
  });
}

function editProfileTool() {
  return agenticTool({
    name: 'editProfile',
    description: 'Open the profile-edit form so the user can review and submit changes.',
    schema: z.object({
      suggestedFullName: z.string().optional().describe('Optional pre-fill for the full name field'),
      suggestedEmail: z.string().email().optional().describe('Optional pre-fill for the email field'),
    }),
    handler: async (suggested) => ({
      ok: true,
      components: [
        {
          name: 'formCard',
          props: {
            formName: 'profileForm',
            initialValues: {
              fullName: suggested.suggestedFullName,
              email: suggested.suggestedEmail,
            },
          },
        },
      ],
    }),
  });
}

// ─── Widgets ──────────────────────────────────────────────────────────────

export const widgets: ComponentDef[] = [
  agenticWidget({
    name: 'formCard',
    component: FormCardComponent,
    propsSchema: z.object({
      formName: z.string(),
      initialValues: z.record(z.unknown()).optional(),
    }),
  }),
  agenticWidget({
    name: 'userInfoCard',
    component: UserInfoCardComponent,
    propsSchema: z.object({
      userId: z.string(),
      fullName: z.string(),
      tier: z.string(),
      lastSeen: z.string(),
    }),
  }),
  agenticWidget({
    name: 'navConfirmation',
    component: NavConfirmationComponent,
    propsSchema: z.object({ destination: z.string() }),
  }),
];

// ─── Mock fetch for the users data source ────────────────────────────────

const mockUsersFetch: typeof fetch = async (input) => {
  const url = typeof input === 'string' ? input : (input as Request).url;
  const id = url.split('/').pop() ?? '';
  const fake = {
    userId: id || 'unknown',
    fullName: id === 'U-1042' ? 'Sahas Sakhare' : `User ${id}`,
    tier: id.endsWith('2') ? 'gold' : 'silver',
    lastSeen: '2026-04-25T10:14:00Z',
  };
  return new Response(JSON.stringify(fake), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
