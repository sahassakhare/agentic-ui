const { withNativeFederation, shareAll } = require('@angular-architects/native-federation/config');

/**
 * `demo-ediscovery-review` — Native Federation remote on :4302.
 *
 * Exposes `./Capability` so the host (`demo-ediscovery-shell`) can load
 * the review tools, widgets, and the `openDocument` action through
 * `loadRemoteCapabilities`.
 */
module.exports = withNativeFederation({
  name: 'demo-ediscovery-review',

  exposes: {
    './Capability': './examples/demo-ediscovery-review/src/app/capability.ts',
  },

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
