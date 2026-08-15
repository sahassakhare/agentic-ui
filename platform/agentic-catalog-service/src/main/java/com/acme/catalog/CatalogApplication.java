package com.acme.catalog;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Agentic Experience Platform — catalog service.
 *
 * A self-hosted, DB-portable (H2 local / Postgres / Oracle) rewrite of the Node
 * catalog server's core: capabilities, experiences (plan / transition / versions
 * / publish / embed), policy, and SSE. Multi-tenant by an application-level
 * {@code tenant_id} scoping. Runs on :8081 — the same contract the Angular
 * Studio + composer already target.
 */
@SpringBootApplication
public class CatalogApplication {
    public static void main(String[] args) {
        SpringApplication.run(CatalogApplication.class, args);
    }
}
