-- Authoring provenance: records whether a capability was drafted by a human or
-- with AI assistance, so AI-assisted drafts stay distinguishable and auditable.
-- Additive and nullable with a 'human' default — existing rows are unaffected.

ALTER TABLE capabilities ADD (authored_by VARCHAR2(20) DEFAULT 'human');
