const { withNativeFederation, shareAll } = require('@angular-architects/native-federation/config');

// The Experience Hub is a federation HOST: it exposes nothing, but shares the
// Angular runtime + the agentic-ui library as singletons so federated component
// remotes (registered in the catalog as kind:'mfe') mount into the same registries.
module.exports = withNativeFederation({
  name: 'agentic-experience-runtime',

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
