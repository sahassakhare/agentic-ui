-- Up Migration
-- AEP Seam B — widen the capabilities.kind CHECK to admit the new registry
-- kinds (Prompt, Skill, Knowledge, Memory, Workflow, Navigation) so they can
-- be catalogued alongside the original 15. Mirrors CAPABILITY_KINDS in
-- src/domain/capability.ts. The original inline CHECK is auto-named
-- `capabilities_kind_check`.

ALTER TABLE capabilities DROP CONSTRAINT IF EXISTS capabilities_kind_check;
ALTER TABLE capabilities ADD CONSTRAINT capabilities_kind_check CHECK (kind IN (
  'tool', 'component', 'capability', 'backend', 'mfe',
  'action', 'intent', 'form', 'datasource',
  'validation', 'persistence', 'layout',
  'schema-transformer', 'approval', 'operation',
  'prompt', 'skill', 'knowledge', 'memory', 'workflow', 'navigation'
));

-- Down Migration
ALTER TABLE capabilities DROP CONSTRAINT IF EXISTS capabilities_kind_check;
ALTER TABLE capabilities ADD CONSTRAINT capabilities_kind_check CHECK (kind IN (
  'tool', 'component', 'capability', 'backend', 'mfe',
  'action', 'intent', 'form', 'datasource',
  'validation', 'persistence', 'layout',
  'schema-transformer', 'approval', 'operation'
));
