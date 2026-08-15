-- Catalog core schema (H2). Portable shape shared with postgresql/oracle; only
-- the large-text (TEXT vs TEXT) and boolean types differ per vendor. JSON is
-- stored as TEXT text (portability over jsonb indexing). "One active publication
-- per experience" is enforced in the service layer (not a partial index).

CREATE TABLE capabilities (
  id                    VARCHAR(36) PRIMARY KEY,
  tenant_id             VARCHAR(120) NOT NULL,
  kind                  VARCHAR(60) NOT NULL,
  name                  VARCHAR(200) NOT NULL,
  body                  TEXT NOT NULL,
  lifecycle             VARCHAR(20) NOT NULL DEFAULT 'published',
  owner                 VARCHAR(120),
  tags                  TEXT NOT NULL,
  required_host_version VARCHAR(40),
  created_at            TIMESTAMP NOT NULL,
  updated_at            TIMESTAMP NOT NULL,
  created_by            VARCHAR(120) NOT NULL,
  soft_deleted_at       TIMESTAMP,
  CONSTRAINT uq_cap_name UNIQUE (tenant_id, kind, name)
);
CREATE INDEX ix_cap_lookup ON capabilities (tenant_id, kind);

CREATE TABLE experiences (
  id              VARCHAR(36) PRIMARY KEY,
  tenant_id       VARCHAR(120) NOT NULL,
  name            VARCHAR(120) NOT NULL,
  title           VARCHAR(200) NOT NULL,
  goal            VARCHAR(2000) NOT NULL,
  body            TEXT NOT NULL,
  approval_state  VARCHAR(20) NOT NULL DEFAULT 'draft',
  approval_chain  TEXT NOT NULL,
  owner           VARCHAR(120),
  tags            TEXT NOT NULL,
  version         VARCHAR(40),
  created_at      TIMESTAMP NOT NULL,
  updated_at      TIMESTAMP NOT NULL,
  created_by      VARCHAR(120) NOT NULL,
  soft_deleted_at TIMESTAMP,
  CONSTRAINT uq_exp_name UNIQUE (tenant_id, name)
);

CREATE TABLE experience_versions (
  id            VARCHAR(36) PRIMARY KEY,
  tenant_id     VARCHAR(120) NOT NULL,
  experience_id VARCHAR(36) NOT NULL,
  version_no    INT NOT NULL,
  snapshot      TEXT NOT NULL,
  reason        VARCHAR(120) NOT NULL,
  created_at    TIMESTAMP NOT NULL,
  created_by    VARCHAR(120) NOT NULL,
  CONSTRAINT uq_exp_ver UNIQUE (tenant_id, experience_id, version_no)
);

CREATE TABLE experience_publications (
  id                   VARCHAR(36) PRIMARY KEY,
  tenant_id            VARCHAR(120) NOT NULL,
  experience_id        VARCHAR(36) NOT NULL,
  experience_name      VARCHAR(120) NOT NULL,
  published_version_no INT NOT NULL,
  key_hash             VARCHAR(80) NOT NULL,
  key_prefix           VARCHAR(40) NOT NULL,
  allowed_origins      TEXT NOT NULL,
  bundle               TEXT NOT NULL,
  status               VARCHAR(20) NOT NULL DEFAULT 'active',
  published_at         TIMESTAMP NOT NULL,
  published_by         VARCHAR(120) NOT NULL,
  revoked_at           TIMESTAMP,
  CONSTRAINT uq_pub_keyhash UNIQUE (key_hash)
);
CREATE INDEX ix_pub_name ON experience_publications (tenant_id, experience_name, status);
CREATE INDEX ix_pub_exp ON experience_publications (tenant_id, experience_id, status);

CREATE TABLE policy_bundles (
  id          VARCHAR(36) PRIMARY KEY,
  tenant_id   VARCHAR(120) NOT NULL,
  name        VARCHAR(120) NOT NULL,
  rego_source TEXT NOT NULL,
  description VARCHAR(2000),
  rule_path   VARCHAR(200) NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMP NOT NULL,
  updated_at  TIMESTAMP NOT NULL,
  created_by  VARCHAR(120) NOT NULL,
  CONSTRAINT uq_policy_name UNIQUE (tenant_id, name)
);
