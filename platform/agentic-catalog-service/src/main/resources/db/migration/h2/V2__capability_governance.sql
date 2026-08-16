-- Capability governance: optimistic concurrency (version), approval workflow
-- (approval_state + approval_chain), and immutable version snapshots — mirrors
-- the experience_versions / approval model already used for experiences.

ALTER TABLE capabilities ADD COLUMN version BIGINT NOT NULL DEFAULT 0;
ALTER TABLE capabilities ADD COLUMN approval_state VARCHAR(20) NOT NULL DEFAULT 'draft';
ALTER TABLE capabilities ADD COLUMN approval_chain CLOB NOT NULL DEFAULT '[]';

-- Existing published capabilities are treated as already-approved so they stay
-- publishable and keep rendering after this migration.
UPDATE capabilities SET approval_state = 'approved' WHERE lifecycle = 'published';

CREATE TABLE capability_versions (
  id            VARCHAR(36) PRIMARY KEY,
  tenant_id     VARCHAR(120) NOT NULL,
  capability_id VARCHAR(36) NOT NULL,
  version_no    INT NOT NULL,
  snapshot      CLOB NOT NULL,
  reason        VARCHAR(120) NOT NULL,
  created_at    TIMESTAMP NOT NULL,
  created_by    VARCHAR(120) NOT NULL,
  CONSTRAINT uq_cap_ver UNIQUE (tenant_id, capability_id, version_no)
);
