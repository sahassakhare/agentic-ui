const { withNativeFederation, shareAll } = require('@angular-architects/native-federation/config');

// The Matter Management app is a federation REMOTE: an enterprise eDiscovery
// domain app (built like any Angular app) that exposes its components as a
// CapabilityModule. The platform (Studio + Hub) loads and orchestrates it.
module.exports = withNativeFederation({
  name: 'matter-management',

  exposes: {
    './Capability': './platform/matter-management-mfe/src/app/capability.ts',
  },

  shared: {
    ...shareAll({ singleton: true, strictVersion: true, requiredVersion: 'auto' }),
    '@infra-tools/agentic-ui': { singleton: true, strictVersion: false, requiredVersion: 'auto' },
  },

  skip: [
    'rxjs/ajax', 'rxjs/fetch', 'rxjs/testing', 'rxjs/webSocket', 'zod-to-json-schema',
  ],

  features: { ignoreUnusedDeps: false },
});
