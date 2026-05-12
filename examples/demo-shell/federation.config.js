const { withNativeFederation, shareAll } = require('@angular-architects/native-federation/config');

module.exports = withNativeFederation({
  name: 'demo-shell',

  shared: {
    ...shareAll({ singleton: true, strictVersion: true, requiredVersion: 'auto' }),
    /**
     * Share @infra-tools/agentic-ui as a singleton. The lib is now a single
     * primary entry (no secondary entries — see ADR-005), so this single
     * registration covers everything: registries, components, AG-UI adapter,
     * MFE helpers, etc. Both host and remote get the same runtime class
     * identities for ToolRegistry / ComponentRegistry / etc., which lets
     * the remote's `defineCapabilityModule.apply(hostInjector)` write to
     * the same instance the chat shell reads from.
     */
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
    /**
     * MUST be false for `@infra-tools/agentic-ui` to actually appear in the
     * shared list. With `true`, Native Federation's static analysis filters
     * the lib out as "unused" and the importmap omits it; the remote's bundle
     * then inlines the lib code, breaking the singleton-class assumption that
     * the registries depend on.
     */
    ignoreUnusedDeps: false,
  },
});
