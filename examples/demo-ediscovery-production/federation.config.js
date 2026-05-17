const { withNativeFederation, shareAll } = require('@angular-architects/native-federation/config');

/**
 * `demo-ediscovery-production` — Native Federation remote on :4303.
 *
 * Exposes `./Capability` for the host (`demo-ediscovery-shell`) to load
 * production-assembly tools, widgets, and the `productionConfigForm`
 * via `loadRemoteCapabilities`.
 */
module.exports = withNativeFederation({
  name: 'demo-ediscovery-production',

  exposes: {
    './Capability':   './examples/demo-ediscovery-production/src/app/capability.ts',
    './RegisterForm': './examples/demo-ediscovery-production/src/app/register-form.ts',
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
