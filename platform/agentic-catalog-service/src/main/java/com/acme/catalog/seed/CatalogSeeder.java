package com.acme.catalog.seed;

import com.acme.catalog.config.CatalogProperties;
import com.acme.catalog.repo.CapabilityRepository;
import com.acme.catalog.repo.ExperienceRepository;
import com.acme.catalog.service.CapabilityService;
import com.acme.catalog.service.ExperienceService;
import com.acme.catalog.support.Json;
import tools.jackson.databind.JsonNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

/**
 * Idempotent baseline seed. On startup (when {@code catalog.seed.enabled}) it
 * upserts {@code seed/catalog.json} — creating only what's missing, never
 * wiping — so a fresh H2-file catalog has resolvable experiences and UI-entered
 * data persists across restarts. The committed {@code scripts/seed-*.mjs} add
 * the richer registries (Material components, previews, prompts/skills/…) against
 * the running service.
 */
@Component
public class CatalogSeeder implements ApplicationRunner {
    private static final Logger log = LoggerFactory.getLogger(CatalogSeeder.class);

    private final CatalogProperties props;
    private final CapabilityService capabilities;
    private final ExperienceService experiences;
    private final CapabilityRepository capRepo;
    private final ExperienceRepository expRepo;
    private final Json json;

    public CatalogSeeder(CatalogProperties props, CapabilityService capabilities, ExperienceService experiences,
                         CapabilityRepository capRepo, ExperienceRepository expRepo, Json json) {
        this.props = props; this.capabilities = capabilities; this.experiences = experiences;
        this.capRepo = capRepo; this.expRepo = expRepo; this.json = json;
    }

    @Override
    public void run(ApplicationArguments args) throws Exception {
        if (!props.getSeed().isEnabled()) return;
        JsonNode root;
        try (var in = new ClassPathResource("seed/catalog.json").getInputStream()) {
            root = json.mapper().readTree(in);
        }
        String tenant = root.path("tenant").asText("acme");
        int caps = 0, exps = 0, approved = 0;

        for (JsonNode cap : root.path("capabilities")) {
            String kind = cap.path("kind").asText();
            String name = cap.path("name").asText();
            if (capRepo.existsByTenantIdAndKindIgnoreCaseAndNameAndSoftDeletedAtIsNull(tenant, kind, name)) continue;
            // Seed data is delivered pre-approved + published so the Hub renders it.
            // (Studio-authored capabilities default to draft and go through review.)
            if (cap instanceof tools.jackson.databind.node.ObjectNode on && !on.hasNonNull("lifecycle"))
                on.put("lifecycle", "published");
            capabilities.create(tenant, cap, "seed@local");
            caps++;
        }

        for (JsonNode exp : root.path("experiences")) {
            String name = exp.path("name").asText();
            boolean approve = exp.path("approve").asBoolean(false);
            var existing = expRepo.findFirstByTenantIdAndNameAndSoftDeletedAtIsNull(tenant, name);
            String id;
            if (existing.isEmpty()) {
                id = experiences.create(tenant, exp, "seed@local").id;
                exps++;
            } else {
                id = existing.get().id;
            }
            var current = expRepo.findByTenantIdAndId(tenant, id).orElseThrow();
            if (approve && !"approved".equals(current.approvalState)) {
                if ("draft".equals(current.approvalState)) experiences.transition(tenant, id, "submit", null, "seed@local");
                experiences.transition(tenant, id, "approve", null, "seed@local");
                approved++;
            }
        }
        log.info("Catalog seed (tenant={}): {} capabilities, {} experiences created, {} approved", tenant, caps, exps, approved);
    }
}
