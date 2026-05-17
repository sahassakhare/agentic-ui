const { withNativeFederation, shareAll } = require('@angular-architects/native-federation/config');

module.exports = withNativeFederation({
  name: 'demo-remote-bookings',

  exposes: {
    './Capability': './examples/demo-remote-bookings/src/app/capability.ts',
  },

  shared: {
    ...shareAll({ singleton: true, strictVersion: true, requiredVersion: 'auto' }),
    /** Mirror demo-shell — share the single primary entry as a singleton. */
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
