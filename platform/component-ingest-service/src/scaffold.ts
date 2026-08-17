/**
 * Scaffold a standalone Native Federation remote workspace for one ingested
 * library — its own Angular workspace (never mutates the host monorepo). The
 * shape mirrors `platform/matter-management-mfe`: a `build`→`esbuild` target pair,
 * `main.ts` (`initFederation`), and `federation.config.js` exposing `./Capability`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface ScaffoldOptions {
  readonly remoteName: string;
  /** The uploaded library's package name — components are imported from it. */
  readonly packageName: string;
  /** How to install it: a version range or a `file:` path to the unpacked tarball. */
  readonly packageSpec: string;
  readonly port: number;
  /** Angular major to build against (must match the host's shared singleton). */
  readonly angularRange?: string;
  readonly agenticUiRange?: string;
}

export function remotePackageJson(o: ScaffoldOptions): unknown {
  const ng = o.angularRange ?? '^20.0.0';
  return {
    name: o.remoteName, private: true, type: 'module',
    scripts: { build: `ng build ${o.remoteName} --configuration production` },
    dependencies: {
      '@angular/animations': ng, '@angular/common': ng, '@angular/compiler': ng, '@angular/core': ng,
      '@angular/forms': ng, '@angular/platform-browser': ng, '@angular/router': ng,
      '@angular-architects/native-federation': ng,
      '@infra-tools/agentic-ui': o.agenticUiRange ?? '^1.4.0',
      'es-module-shims': '^1.10.0', rxjs: '^7.8.0', zod: '^3.23.0',
      [o.packageName]: o.packageSpec,
    },
    devDependencies: { '@angular/build': ng, '@angular/cli': ng, typescript: '~5.6.0' },
  };
}

export function remoteAngularJson(o: ScaffoldOptions): unknown {
  return {
    $schema: './node_modules/@angular/cli/lib/config/schema.json', version: 1,
    projects: {
      [o.remoteName]: {
        projectType: 'application', root: '', sourceRoot: 'src',
        architect: {
          build: { builder: '@angular-architects/native-federation:build', options: {} },
          esbuild: {
            builder: '@angular/build:application',
            options: { browser: 'src/main.ts', polyfills: ['es-module-shims'], tsConfig: 'tsconfig.app.json', outputPath: `dist/${o.remoteName}` },
            configurations: { production: {}, development: { optimization: false, sourceMap: true } },
            defaultConfiguration: 'production',
          },
          serve: { builder: '@angular-architects/native-federation:build', options: { target: `${o.remoteName}:serve-original:development`, port: o.port } },
          'serve-original': { builder: '@angular/build:dev-server', options: { port: o.port, host: '0.0.0.0' } },
        },
      },
    },
  };
}

export function federationConfig(o: ScaffoldOptions): string {
  return `const { withNativeFederation, shareAll } = require('@angular-architects/native-federation/config');

module.exports = withNativeFederation({
  name: '${o.remoteName}',
  exposes: { './Capability': './src/capability.ts' },
  shared: {
    ...shareAll({ singleton: true, strictVersion: false, requiredVersion: 'auto' }),
    '@infra-tools/agentic-ui': { singleton: true, strictVersion: false, requiredVersion: 'auto' },
  },
  skip: ['rxjs/ajax', 'rxjs/fetch', 'rxjs/testing', 'rxjs/webSocket', 'zod-to-json-schema'],
});
`;
}

export const MAIN_TS = `import { initFederation } from '@angular-architects/native-federation';

// A pure remote: no app bootstrap — it only exposes './Capability' to the host.
initFederation().catch((err) => console.error(err));
`;

export function tsconfigBase(): unknown {
  return {
    compilerOptions: {
      target: 'ES2022', module: 'preserve', moduleResolution: 'bundler', lib: ['ES2022', 'DOM'],
      strict: true, skipLibCheck: true, useDefineForClassFields: false,
    },
  };
}

export function tsconfigApp(): unknown {
  return { extends: './tsconfig.json', compilerOptions: { outDir: './out-tsc/app' }, files: ['src/main.ts'], include: ['src/**/*.ts'] };
}

/** Write the whole workspace to `dir`, including the generated `capability.ts`. */
export function scaffoldRemote(dir: string, o: ScaffoldOptions, capabilityTs: string): void {
  const write = (rel: string, content: string): void => {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  };
  write('package.json', JSON.stringify(remotePackageJson(o), null, 2));
  write('angular.json', JSON.stringify(remoteAngularJson(o), null, 2));
  write('tsconfig.json', JSON.stringify(tsconfigBase(), null, 2));
  write('tsconfig.app.json', JSON.stringify(tsconfigApp(), null, 2));
  write('federation.config.js', federationConfig(o));
  write('src/main.ts', MAIN_TS);
  write('src/capability.ts', capabilityTs);
}
