const { withNativeFederation, shareAll } = require('@angular-architects/native-federation/config');

// The Experience Hub is a federation HOST: it exposes nothing, but shares the
// Angular runtime + the agentic-ui library as singletons so federated component
// remotes (registered in the catalog as kind:'mfe') mount into the same registries.
module.exports = withNativeFederation({
  name: 'agentic-experience-runtime',

  shared: {
    ...shareAll({ singleton: true, strictVersion: true, requiredVersion: 'auto' }),
    '@infra-tools/agentic-ui': { singleton: true, strictVersion: false, requiredVersion: 'auto' },
    // Host-level catalog consumption (ADR-0052): mapped into the host's import
    // map so the subpath resolves at runtime, but NON-singleton — it is not a
    // cross-remote shared class (remotes must never import it). Its internal
    // imports of the primary '@infra-tools/agentic-ui' still resolve to the shared singleton.
    '@infra-tools/agentic-ui/catalog': { singleton: false, strictVersion: false, requiredVersion: 'auto' },
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
