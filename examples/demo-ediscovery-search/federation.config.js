const { withNativeFederation, shareAll } = require('@angular-architects/native-federation/config');

/**
 * `demo-ediscovery-search` — Native Federation remote on :4304.
 *
 * Exposes:
 *   - ./Capability    — search tools + widgets
 *   - ./RegisterDataSource — `documentIndex` DataSource registration
 */
module.exports = withNativeFederation({
  name: 'demo-ediscovery-search',

  exposes: {
    './Capability':         './examples/demo-ediscovery-search/src/app/capability.ts',
    './RegisterDataSource': './examples/demo-ediscovery-search/src/app/register-data-source.ts',
  },

  shared: {
    ...shareAll({ singleton: true, strictVersion: true, requiredVersion: 'auto' }),
    '@maverick/agentic-ui': { singleton: true, strictVersion: false, requiredVersion: 'auto' },
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
