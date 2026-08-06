package com.acme.catalog.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.List;

/** Binds the {@code catalog.*} config (auth mode, OIDC, writer roles, seed, CORS). */
@ConfigurationProperties("catalog")
public class CatalogProperties {
    private Auth auth = new Auth();
    private Seed seed = new Seed();
    private Cors cors = new Cors();

    public Auth getAuth() { return auth; }
    public void setAuth(Auth auth) { this.auth = auth; }
    public Seed getSeed() { return seed; }
    public void setSeed(Seed seed) { this.seed = seed; }
    public Cors getCors() { return cors; }
    public void setCors(Cors cors) { this.cors = cors; }

    public boolean authDisabled() { return "disabled".equalsIgnoreCase(auth.mode); }

    public static class Auth {
        /** 'oidc' | 'disabled'. */
        public String mode = "oidc";
        public String issuer = "http://127.0.0.1:9100";
        public String audience = "agentic-catalog";
        public String writerRoles = "platform-admin,catalog-admin,editor";
        public List<String> writerRoleList() {
            return List.of(writerRoles.split("\\s*,\\s*"));
        }
        public String getMode() { return mode; } public void setMode(String v) { mode = v; }
        public String getIssuer() { return issuer; } public void setIssuer(String v) { issuer = v; }
        public String getAudience() { return audience; } public void setAudience(String v) { audience = v; }
        public String getWriterRoles() { return writerRoles; } public void setWriterRoles(String v) { writerRoles = v; }
    }
    public static class Seed {
        public boolean enabled = false;
        public boolean isEnabled() { return enabled; } public void setEnabled(boolean v) { enabled = v; }
    }
    public static class Cors {
        public String origins = "http://localhost:4600,http://localhost:4210";
        public List<String> originList() { return List.of(origins.split("\\s*,\\s*")); }
        public String getOrigins() { return origins; } public void setOrigins(String v) { origins = v; }
    }
}
