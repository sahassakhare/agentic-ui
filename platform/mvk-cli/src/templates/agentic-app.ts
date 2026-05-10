/**
 * Inline templates for `mvk new app <name>`. Each template is a
 * function so we can keep variable interpolation typed + escape
 * untrusted input ourselves (the only untrusted input is the
 * project name, and we validate it before passing in).
 *
 * Templates are intentionally minimal — a starting point, not a
 * showcase. Adopters customise from here.
 */

export interface ScaffoldVars {
  /** Project name. Used for package name + Angular project name. */
  readonly name: string;
  /** Optional catalog URL for `--with-catalog` registrations. */
  readonly catalogUrl?: string;
  /**
   * When true, scaffold the app preconfigured with
   * `provideAgenticPlatform` wiring. Requires `catalogUrl`.
   * Defaults to false for the platform-naive starter.
   */
  readonly withPlatform?: boolean;
  /** Optional tenant id for the platform wiring; defaults to project name. */
  readonly tenantId?: string;
}

interface TemplateFile {
  readonly path: string;
  readonly content: string;
  readonly mode?: number;
}

export function renderAgenticAppTemplate(vars: ScaffoldVars): readonly TemplateFile[] {
  const { name } = vars;
  return [
    { path: 'package.json', content: packageJson(name) },
    { path: 'angular.json', content: angularJson(name) },
    { path: 'tsconfig.json', content: tsconfigJson() },
    { path: 'tsconfig.app.json', content: tsconfigAppJson() },
    { path: '.gitignore', content: gitignore() },
    { path: 'README.md', content: readme(name, vars.catalogUrl) },
    { path: 'src/main.ts', content: mainTs() },
    { path: 'src/index.html', content: indexHtml(name) },
    { path: 'src/styles.scss', content: stylesScss() },
    { path: 'src/app/app.config.ts', content: appConfigTs(vars) },
    { path: 'src/app/app.component.ts', content: appComponentTs(name) },
  ];
}

function packageJson(name: string): string {
  return JSON.stringify({
    name,
    version: '0.1.0',
    private: true,
    scripts: {
      ng: 'ng',
      start: 'ng serve',
      build: 'ng build',
      test: 'ng test',
    },
    dependencies: {
      '@angular/animations': '^21.2.0',
      '@angular/common': '^21.2.0',
      '@angular/compiler': '^21.2.0',
      '@angular/core': '^21.2.0',
      '@angular/forms': '^21.2.0',
      '@angular/platform-browser': '^21.2.0',
      '@angular/platform-browser-dynamic': '^21.2.0',
      '@angular/router': '^21.2.0',
      '@maverick/agentic-ui': '^1.0.0',
      rxjs: '~7.8.0',
      tslib: '^2.6.0',
      'zone.js': '~0.14.0',
      zod: '^3.23.0',
    },
    devDependencies: {
      '@angular/build': '^21.2.0',
      '@angular/cli': '^21.2.0',
      '@angular/compiler-cli': '^21.2.0',
      '@types/node': '^22.0.0',
      typescript: '~5.9.0',
    },
  }, null, 2) + '\n';
}

function angularJson(name: string): string {
  return JSON.stringify({
    $schema: './node_modules/@angular/cli/lib/config/schema.json',
    version: 1,
    newProjectRoot: 'projects',
    projects: {
      [name]: {
        projectType: 'application',
        root: '',
        sourceRoot: 'src',
        prefix: 'app',
        architect: {
          build: {
            builder: '@angular/build:application',
            options: {
              outputPath: 'dist',
              index: 'src/index.html',
              browser: 'src/main.ts',
              tsConfig: 'tsconfig.app.json',
              inlineStyleLanguage: 'scss',
              styles: ['src/styles.scss'],
            },
            configurations: {
              production: {
                budgets: [
                  { type: 'initial', maximumWarning: '500kB', maximumError: '1MB' },
                ],
                outputHashing: 'all',
              },
              development: {
                optimization: false,
                extractLicenses: false,
                sourceMap: true,
              },
            },
            defaultConfiguration: 'production',
          },
          serve: {
            builder: '@angular/build:dev-server',
            configurations: {
              production: { buildTarget: `${name}:build:production` },
              development: { buildTarget: `${name}:build:development` },
            },
            defaultConfiguration: 'development',
          },
        },
      },
    },
  }, null, 2) + '\n';
}

function tsconfigJson(): string {
  return JSON.stringify({
    compileOnSave: false,
    compilerOptions: {
      strict: true,
      noImplicitOverride: true,
      noPropertyAccessFromIndexSignature: true,
      noImplicitReturns: true,
      noFallthroughCasesInSwitch: true,
      skipLibCheck: true,
      isolatedModules: true,
      experimentalDecorators: true,
      moduleResolution: 'bundler',
      importHelpers: true,
      target: 'ES2022',
      module: 'ES2022',
      lib: ['ES2022', 'DOM'],
    },
    angularCompilerOptions: {
      enableI18nLegacyMessageIdFormat: false,
      strictInjectionParameters: true,
      strictInputAccessModifiers: true,
      strictTemplates: true,
    },
  }, null, 2) + '\n';
}

function tsconfigAppJson(): string {
  return JSON.stringify({
    extends: './tsconfig.json',
    compilerOptions: { types: [] },
    files: ['src/main.ts'],
    include: ['src/**/*.d.ts'],
  }, null, 2) + '\n';
}

function gitignore(): string {
  return [
    '# Build artifacts',
    '/dist',
    '/tmp',
    '/out-tsc',
    '/.angular',
    '',
    '# Dependencies',
    '/node_modules',
    '',
    '# IDE',
    '.vscode/*',
    '!.vscode/extensions.json',
    '.idea',
    '',
    '# Misc',
    '.DS_Store',
    'npm-debug.log',
    'yarn-error.log',
    '',
  ].join('\n');
}

function readme(name: string, catalogUrl?: string): string {
  return `# ${name}

Generated by \`mvk new app ${name}\`. Minimal Angular app preconfigured
with [\`@maverick/agentic-ui\`](https://github.com/sahassakhare/agentic-ui).

## Quick start

\`\`\`bash
npm install
npm start
# → http://localhost:4200
\`\`\`

## Next steps

1. Wire your agentic backend in \`src/app/app.config.ts\` — replace the
   no-op backend provider with \`provideAgUiBackend\`,
   \`provideHashbrownBackend\`, etc. depending on which agent you're
   running.
2. Register tools / widgets / forms in \`src/app/app.config.ts\` via
   the \`tools\` / \`widgets\` arrays passed to \`provideAgenticUi\`.
3. Mount the chat shell or any of the runtime's components from
   \`src/app/app.component.ts\`.

${catalogUrl ? `## Catalog
This app was scaffolded with \`--with-catalog ${catalogUrl}\`. The
catalog has a sample capability registered under tenant \`${name}\`.
Run \`mvk capability list --tenant ${name}\` to see it.

` : ''}## Docs

- [@maverick/agentic-ui](https://github.com/sahassakhare/agentic-ui/blob/main/projects/agentic-ui/README.md) — runtime API
- [Platform plan](https://github.com/sahassakhare/agentic-ui/blob/main/docs/plans/platform-evolution-plan.md) — architecture overview
- [\`mvk\` CLI](https://github.com/sahassakhare/agentic-ui/blob/main/platform/mvk-cli/README.md)
`;
}

function mainTs(): string {
  return `import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app.component';

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
`;
}

function indexHtml(name: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${name}</title>
  <base href="/">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>
  <app-root></app-root>
</body>
</html>
`;
}

function stylesScss(): string {
  return `:root {
  --bg: #fafafa;
  --fg: #1a1a1a;
}

html, body {
  margin: 0;
  padding: 0;
  height: 100%;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  background: var(--bg);
  color: var(--fg);
}
`;
}

function appConfigTs(vars: ScaffoldVars): string {
  if (vars.withPlatform && vars.catalogUrl) {
    return appConfigWithPlatformTs(vars);
  }
  return `import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideAgenticUi } from '@maverick/agentic-ui';

/**
 * Wire your tools / widgets / forms here. The arrays below start
 * empty — register concrete entries to see them surface in the
 * runtime's chat shell, dynamic-form widgets, etc.
 *
 * See @maverick/agentic-ui docs:
 *   https://github.com/sahassakhare/agentic-ui/blob/main/projects/agentic-ui/README.md
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideAgenticUi({
      tools: [
        // { kind: 'tool', name: 'echo', description: '...', execute: ... }
      ],
      widgets: [
        // { kind: 'component', name: 'my-card', selector: 'my-card', ... }
      ],
    }),
    // Add your backend here:
    //   provideAgUiBackend({ url: 'http://localhost:3000' })
    //   provideHashbrownBackend(...)
    //   provideA2uiBackend(...)
  ],
};
`;
}

function appConfigWithPlatformTs(vars: ScaffoldVars): string {
  const tenant = vars.tenantId ?? vars.name;
  return `import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import {
  provideAgenticUi,
  provideAgenticPlatform,
} from '@maverick/agentic-ui';

/**
 * Wire your tools / widgets / forms here. The arrays below start
 * empty — register concrete entries to see them surface in the
 * runtime's chat shell, dynamic-form widgets, etc.
 *
 * provideAgenticPlatform connects this app to the Maverick catalog
 * server: per-tenant IAM persona resolution + federated MFE
 * discovery. Tenant + token come from a single options object so
 * future platform features (capability registrar / authorizer /
 * usage metering) plug in without re-threading config through
 * multiple providers. Closes Gap 4 from the 2026-05-10 platform
 * audit.
 */
const CATALOG_URL = '${vars.catalogUrl}';
const TENANT_ID = '${tenant}';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideAgenticUi({
      tools: [
        // { kind: 'tool', name: 'echo', description: '...', execute: ... }
      ],
      widgets: [
        // { kind: 'component', name: 'my-card', selector: 'my-card', ... }
      ],
    }),
    provideAgenticPlatform({
      catalogUrl: CATALOG_URL,
      tenantId: TENANT_ID,
      // For demo deployments running AUTH_MODE=disabled (no IdP),
      // return null. Production deployments wire this to your OIDC
      // client (Auth0 / msal-js / oidc-client-ts).
      getToken: () => null,
      personaResolver: { defaultPersona: 'default' },
      mfeRegistry: { refreshIntervalMs: 30_000 },
    }),
    // Add your backend here:
    //   provideAgUiBackend({ url: 'http://localhost:3000' })
    //   provideHashbrownBackend(...)
    //   provideA2uiBackend(...)
  ],
};
`;
}

function appComponentTs(name: string): string {
  return `import { Component } from '@angular/core';

@Component({
  selector: 'app-root',
  template: \`
    <main>
      <h1>${name}</h1>
      <p>
        Generated by <code>mvk new app</code>. Edit
        <code>src/app/app.component.ts</code> to mount the chat
        shell or any of the runtime's components.
      </p>
      <p>
        See <code>src/app/app.config.ts</code> to wire your tools,
        widgets, and backend.
      </p>
    </main>
  \`,
  styles: [\`
    main { max-width: 720px; margin: 48px auto; padding: 24px; }
    h1 { margin: 0 0 16px; }
    p { line-height: 1.6; }
    code { background: #f0f0f0; padding: 2px 6px; border-radius: 4px; font-family: ui-monospace, monospace; }
  \`],
})
export class App {}
`;
}

/** Validates the name is safe to use as a directory + npm package. */
export function validateProjectName(name: string): { ok: true } | { ok: false; reason: string } {
  if (!name) return { ok: false, reason: 'project name is required' };
  if (name.length > 214) return { ok: false, reason: 'project name must be ≤214 chars' };
  if (!/^[a-z][a-z0-9_-]*$/.test(name)) {
    return {
      ok: false,
      reason: 'project name must start with a lowercase letter and contain only [a-z0-9_-]',
    };
  }
  if (['node_modules', '.', '..', 'package.json'].includes(name)) {
    return { ok: false, reason: `'${name}' is reserved` };
  }
  return { ok: true };
}
