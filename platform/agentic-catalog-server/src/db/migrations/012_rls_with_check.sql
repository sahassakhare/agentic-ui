-- Up Migration
-- Defense-in-depth for tenant isolation (audit findings A6 / A7).
--
-- Postgres already applies a policy's USING expression as the implicit
-- WITH CHECK, so writes were never wide open — but the check was implicit and,
-- on the tables carrying the `OR current_setting('app.tenant_id') = ''`
-- read-escape (experiences, policy_bundles), that escape also widened the
-- implicit insert check. This migration makes the WITH CHECK explicit on every
-- tenant-scoped write policy and, on the escape-carrying tables, keeps the
-- cross-tenant READ escape for platform-admin while forcing every WRITE to
-- match the active tenant exactly. No legitimate path writes under an empty
-- `app.tenant_id` (withTenantScope always sets a concrete tenant), so this is
-- behavior-preserving hardening.

DROP POLICY IF EXISTS capabilities_tenant_isolation ON capabilities;
CREATE POLICY capabilities_tenant_isolation ON capabilities
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS mfe_remotes_tenant_isolation ON mfe_remotes;
CREATE POLICY mfe_remotes_tenant_isolation ON mfe_remotes
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS experiences_tenant_isolation ON experiences;
CREATE POLICY experiences_tenant_isolation ON experiences
  USING (tenant_id = current_setting('app.tenant_id', true)
         OR current_setting('app.tenant_id', true) = '')
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS policy_bundles_tenant_isolation ON policy_bundles;
CREATE POLICY policy_bundles_tenant_isolation ON policy_bundles
  USING (tenant_id = current_setting('app.tenant_id', true)
         OR current_setting('app.tenant_id', true) = '')
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS agents_tenant_isolation ON agents;
CREATE POLICY agents_tenant_isolation ON agents
  USING (tenant_id = current_setting('app.tenant_id', true)
         OR current_setting('app.tenant_id', true) = '')
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- Down Migration
DROP POLICY IF EXISTS capabilities_tenant_isolation ON capabilities;
CREATE POLICY capabilities_tenant_isolation ON capabilities
  USING (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS mfe_remotes_tenant_isolation ON mfe_remotes;
CREATE POLICY mfe_remotes_tenant_isolation ON mfe_remotes
  USING (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS experiences_tenant_isolation ON experiences;
CREATE POLICY experiences_tenant_isolation ON experiences
  USING (tenant_id = current_setting('app.tenant_id', true)
         OR current_setting('app.tenant_id', true) = '');

DROP POLICY IF EXISTS policy_bundles_tenant_isolation ON policy_bundles;
CREATE POLICY policy_bundles_tenant_isolation ON policy_bundles
  USING (tenant_id = current_setting('app.tenant_id', true)
         OR current_setting('app.tenant_id', true) = '');

DROP POLICY IF EXISTS agents_tenant_isolation ON agents;
CREATE POLICY agents_tenant_isolation ON agents
  USING (tenant_id = current_setting('app.tenant_id', true)
         OR current_setting('app.tenant_id', true) = '');
