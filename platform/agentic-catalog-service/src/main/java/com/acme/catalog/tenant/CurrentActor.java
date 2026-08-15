package com.acme.catalog.tenant;

import com.acme.catalog.config.CatalogProperties;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Resolves the {@link Actor} for the current request from the Spring Security
 * context (JWT), or a synthetic platform-admin when auth is disabled. Also the
 * tenant-scope guard: the path {tenant} must equal the JWT {@code tenant_id}
 * claim (platform-admin / disabled bypass) — mirrors the Node requireTenantScope.
 */
@Component
public class CurrentActor {
    private final CatalogProperties props;

    public CurrentActor(CatalogProperties props) { this.props = props; }

    public Actor resolve() {
        if (props.authDisabled()) return Actor.synthetic();
        var auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth instanceof JwtAuthenticationToken jwtAuth) {
            Jwt jwt = jwtAuth.getToken();
            String tenant = jwt.getClaimAsString("tenant_id");
            String subject = jwt.getSubject();
            String issuer = jwt.getIssuer() != null ? jwt.getIssuer().toString() : "unknown";
            Set<String> roles = new HashSet<>();
            Object claim = jwt.getClaim("roles");
            if (claim instanceof List<?> list) list.forEach(r -> roles.add(String.valueOf(r)));
            return new Actor(subject + "@" + issuer, tenant, roles, roles.contains("platform-admin"), false);
        }
        return Actor.synthetic();
    }

    /** Assert the path tenant matches the caller's tenant (unless admin/disabled). */
    public Actor requireTenant(String pathTenant) {
        Actor a = resolve();
        if (!a.authDisabled() && !a.platformAdmin() && !pathTenant.equals(a.tenant())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Tenant scope mismatch");
        }
        return a;
    }
}
