-- Catalog core schema (H2). Portable shape shared with postgresql/oracle; only
-- the large-text (CLOB vs TEXT) and boolean types differ per vendor. JSON is
-- stored as CLOB text (portability over jsonb indexing). "One active publication
-- per experience" is enforced in the service layer (not a partial index).

CREATE TABLE capabilities (
  id                    VARCHAR2(36) PRIMARY KEY,
  tenant_id             VARCHAR2(120) NOT NULL,
  kind                  VARCHAR2(60) NOT NULL,
  name                  VARCHAR2(200) NOT NULL,
  body                  CLOB NOT NULL,
  lifecycle             VARCHAR2(20) NOT NULL DEFAULT 'published',
  owner                 VARCHAR2(120),
  tags                  CLOB NOT NULL,
  required_host_version VARCHAR2(40),
  created_at            TIMESTAMP NOT NULL,
  updated_at            TIMESTAMP NOT NULL,
  created_by            VARCHAR2(120) NOT NULL,
  soft_deleted_at       TIMESTAMP,
  CONSTRAINT uq_cap_name UNIQUE (tenant_id, kind, name)
);
CREATE INDEX ix_cap_lookup ON capabilities (tenant_id, kind);

CREATE TABLE experiences (
  id              VARCHAR2(36) PRIMARY KEY,
  tenant_id       VARCHAR2(120) NOT NULL,
  name            VARCHAR2(120) NOT NULL,
  title           VARCHAR2(200) NOT NULL,
  goal            VARCHAR2(2000) NOT NULL,
  body            CLOB NOT NULL,
  approval_state  VARCHAR2(20) NOT NULL DEFAULT 'draft',
  approval_chain  CLOB NOT NULL,
  owner           VARCHAR2(120),
  tags            CLOB NOT NULL,
  version         VARCHAR2(40),
  created_at      TIMESTAMP NOT NULL,
  updated_at      TIMESTAMP NOT NULL,
  created_by      VARCHAR2(120) NOT NULL,
  soft_deleted_at TIMESTAMP,
  CONSTRAINT uq_exp_name UNIQUE (tenant_id, name)
);

CREATE TABLE experience_versions (
  id            VARCHAR2(36) PRIMARY KEY,
  tenant_id     VARCHAR2(120) NOT NULL,
  experience_id VARCHAR2(36) NOT NULL,
  version_no    NUMBER(10) NOT NULL,
  snapshot      CLOB NOT NULL,
  reason        VARCHAR2(120) NOT NULL,
  created_at    TIMESTAMP NOT NULL,
  created_by    VARCHAR2(120) NOT NULL,
  CONSTRAINT uq_exp_ver UNIQUE (tenant_id, experience_id, version_no)
);

CREATE TABLE experience_publications (
  id                   VARCHAR2(36) PRIMARY KEY,
  tenant_id            VARCHAR2(120) NOT NULL,
  experience_id        VARCHAR2(36) NOT NULL,
  experience_name      VARCHAR2(120) NOT NULL,
  published_version_no NUMBER(10) NOT NULL,
  key_hash             VARCHAR2(80) NOT NULL,
  key_prefix           VARCHAR2(40) NOT NULL,
  allowed_origins      CLOB NOT NULL,
  bundle               CLOB NOT NULL,
  status               VARCHAR2(20) NOT NULL DEFAULT 'active',
  published_at         TIMESTAMP NOT NULL,
  published_by         VARCHAR2(120) NOT NULL,
  revoked_at           TIMESTAMP,
  CONSTRAINT uq_pub_keyhash UNIQUE (key_hash)
);
CREATE INDEX ix_pub_name ON experience_publications (tenant_id, experience_name, status);
CREATE INDEX ix_pub_exp ON experience_publications (tenant_id, experience_id, status);

CREATE TABLE policy_bundles (
  id          VARCHAR2(36) PRIMARY KEY,
  tenant_id   VARCHAR2(120) NOT NULL,
  name        VARCHAR2(120) NOT NULL,
  rego_source CLOB NOT NULL,
  description VARCHAR2(2000),
  rule_path   VARCHAR2(200) NOT NULL,
  is_active   NUMBER(1) DEFAULT 0 NOT NULL,
  created_at  TIMESTAMP NOT NULL,
  updated_at  TIMESTAMP NOT NULL,
  created_by  VARCHAR2(120) NOT NULL,
  CONSTRAINT uq_policy_name UNIQUE (tenant_id, name)
);
