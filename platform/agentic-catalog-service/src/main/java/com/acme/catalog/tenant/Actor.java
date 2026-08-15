package com.acme.catalog.tenant;

import java.util.Set;

/** The authenticated caller for the current request (or a synthetic admin when
 *  auth is disabled). {@code id} is the audit-attribution string (createdBy). */
public record Actor(String id, String tenant, Set<String> roles, boolean platformAdmin, boolean authDisabled) {
    public static Actor synthetic() {
        return new Actor("system@local", null, Set.of("platform-admin"), true, true);
    }
}
