-- Capability governance: optimistic concurrency (version), approval workflow
-- (approval_state + approval_chain), and immutable version snapshots — mirrors
-- the experience_versions / approval model already used for experiences.

ALTER TABLE capabilities ADD (version NUMBER(19) DEFAULT 0 NOT NULL);
ALTER TABLE capabilities ADD (approval_state VARCHAR2(20) DEFAULT 'draft' NOT NULL);
ALTER TABLE capabilities ADD (approval_chain CLOB DEFAULT '[]' NOT NULL);

-- Existing published capabilities are treated as already-approved so they stay
-- publishable and keep rendering after this migration.
UPDATE capabilities SET approval_state = 'approved' WHERE lifecycle = 'published';

CREATE TABLE capability_versions (
  id            VARCHAR2(36) PRIMARY KEY,
  tenant_id     VARCHAR2(120) NOT NULL,
  capability_id VARCHAR2(36) NOT NULL,
  version_no    NUMBER(10) NOT NULL,
  snapshot      CLOB NOT NULL,
  reason        VARCHAR2(120) NOT NULL,
  created_at    TIMESTAMP NOT NULL,
  created_by    VARCHAR2(120) NOT NULL,
  CONSTRAINT uq_cap_ver UNIQUE (tenant_id, capability_id, version_no)
);
