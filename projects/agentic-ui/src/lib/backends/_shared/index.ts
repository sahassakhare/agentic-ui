/**
 * Shared canonical converters consumed by every backend adapter.
 *
 * The lib carries an internal canonical shape (`AgenticMessage`,
 * `ToolDef`, `AgenticEvent`). Each backend speaks a different wire
 * shape; the converters in this folder are the canonical → wire
 * boundary. Before slice L1 (`docs/plans/library-hardening-plan.md`)
 * landed, AG-UI had typed converters in `backends/ag-ui/converters.ts`
 * and Hashbrown + A2UI posted the canonical shape raw — silently
 * losing tool schemas and `state` threading.
 *
 * Public surface:
 *   - {@link flattenContentToString}     multi-modal → text fallback
 *   - {@link convertMessagesToOpenAi}    canonical → OpenAI chat shape
 *   - {@link convertToolsToOpenAi}       ToolDef[] → OpenAI tool shape
 *   - {@link parseMaybeJson}             best-effort JSON string parse
 *   - {@link extractWidgetRenders}       `{components: [...]}` → widget events
 *
 * AG-UI continues to have its own thin converter wrapper because
 * `@ag-ui/client` ships specific `Message` / `Tool` runtime types
 * with extra fields; the wrapper translates the OpenAI-shape output
 * here into those.
 */
export * from './canonical-messages';
export * from './canonical-events';
