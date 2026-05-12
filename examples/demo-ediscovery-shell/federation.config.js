const { withNativeFederation, shareAll } = require('@angular-architects/native-federation/config');

/**
 * Host federation config for `demo-ediscovery-shell`. Mirrors `demo-shell` —
 * `@infra-tools/agentic-ui` shares as a singleton so the host's `ToolRegistry`
 * / `ComponentRegistry` instances are the same objects the remotes write
 * into through `defineCapabilityModule`.
 */
module.exports = withNativeFederation({
  name: 'demo-ediscovery-shell',

  shared: {
    ...shareAll({ singleton: true, strictVersion: true, requiredVersion: 'auto' }),
    '@infra-tools/agentic-ui': { singleton: true, strictVersion: false, requiredVersion: 'auto' },
  },

  skip: [
    'rxjs/ajax',
    'rxjs/fetch',
    'rxjs/testing',
    'rxjs/webSocket',
    'zod-to-json-schema',
  ],

  features: {
    ignoreUnusedDeps: false,
  },
});
