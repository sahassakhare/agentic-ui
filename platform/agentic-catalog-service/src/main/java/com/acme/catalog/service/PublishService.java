package com.acme.catalog.service;

import com.acme.catalog.domain.Capability;
import com.acme.catalog.domain.Experience;
import com.acme.catalog.domain.ExperiencePublication;
import com.acme.catalog.repo.CapabilityRepository;
import com.acme.catalog.repo.ExperiencePublicationRepository;
import com.acme.catalog.support.EmbedKey;
import com.acme.catalog.support.Ids;
import com.acme.catalog.support.Json;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/** Headless publishing — freeze a render bundle behind an origin-pinned embed key
 *  (ports publication-repo + bundle + the publish/embed routes). */
@Service
public class PublishService {
    public record PublishResult(ExperiencePublication publication, String rawKey) {}

    private final ExperiencePublicationRepository pubs;
    private final CapabilityRepository caps;
    private final Json json;

    public PublishService(ExperiencePublicationRepository pubs, CapabilityRepository caps, Json json) {
        this.pubs = pubs; this.caps = caps; this.json = json;
    }

    public Optional<ExperiencePublication> activeByExperienceId(String tenant, String expId) {
        return pubs.findFirstByTenantIdAndExperienceIdAndStatus(tenant, expId, "active");
    }
    public Optional<ExperiencePublication> activeByName(String tenant, String name) {
        return pubs.findFirstByTenantIdAndExperienceNameAndStatus(tenant, name, "active");
    }
    public Optional<ExperiencePublication> activeByKeyHash(String tenant, String keyHash) {
        return pubs.findFirstByKeyHashAndTenantIdAndStatus(keyHash, tenant, "active");
    }

    @Transactional
    public PublishResult publish(String tenant, Experience exp, int versionNo, List<String> allowedOrigins, String actor) {
        Instant now = Instant.now();
        String raw = EmbedKey.mint();
        activeByExperienceId(tenant, exp.id).ifPresent(p -> { p.status = "revoked"; p.revokedAt = now; pubs.save(p); });
        ExperiencePublication p = new ExperiencePublication();
        p.id = Ids.uuid();
        p.tenantId = tenant;
        p.experienceId = exp.id;
        p.experienceName = exp.name;
        p.publishedVersionNo = versionNo;
        p.keyHash = EmbedKey.hash(raw);
        p.keyPrefix = EmbedKey.prefixOf(raw);
        p.allowedOrigins = json.write(allowedOrigins);
        p.bundle = buildBundle(tenant, exp, versionNo, now);
        p.status = "active";
        p.publishedAt = now;
        p.publishedBy = actor;
        pubs.save(p);
        return new PublishResult(p, raw);
    }

    @Transactional
    public Optional<ExperiencePublication> unpublish(String tenant, String expId) {
        return activeByExperienceId(tenant, expId).map(p -> {
            p.status = "revoked"; p.revokedAt = Instant.now(); return pubs.save(p);
        });
    }

    @Transactional
    public Optional<PublishResult> rotate(String tenant, String expId) {
        return activeByExperienceId(tenant, expId).map(p -> {
            String raw = EmbedKey.mint();
            p.keyHash = EmbedKey.hash(raw); p.keyPrefix = EmbedKey.prefixOf(raw);
            pubs.save(p);
            return new PublishResult(p, raw);
        });
    }

    /** Assemble the frozen render manifest: experience + workflow steps + widget metadata. */
    private String buildBundle(String tenant, Experience exp, int versionNo, Instant publishedAt) {
        JsonNode expBody = json.read(exp.body);
        ObjectNode bundle = json.mapper().createObjectNode();

        ObjectNode e = bundle.putObject("experience");
        e.put("name", exp.name); e.put("title", exp.title); e.put("goal", exp.goal);
        if (expBody.hasNonNull("defaultLayout")) e.put("defaultLayout", expBody.get("defaultLayout").asText());

        // workflow steps from the referenced workflow capability
        ArrayNode steps = null;
        String wfName = firstRequireName(expBody.path("requires"), "workflow");
        if (wfName != null) {
            Capability wf = caps.findFirstByTenantIdAndKindIgnoreCaseAndNameAndSoftDeletedAtIsNull(tenant, "workflow", wfName).orElse(null);
            if (wf != null) {
                JsonNode b = json.read(wf.body);
                JsonNode raw = b.path("workflow").has("steps") ? b.path("workflow").path("steps") : b.path("steps");
                if (raw.isArray()) {
                    steps = json.mapper().createArrayNode();
                    for (JsonNode s : raw) {
                        if (!s.hasNonNull("id") || !s.hasNonNull("widget")) continue;
                        ObjectNode step = json.mapper().createObjectNode();
                        step.put("id", s.get("id").asText());
                        step.put("widget", s.get("widget").asText());
                        if (s.hasNonNull("section")) step.put("section", s.get("section").asText());
                        JsonNode next = s.get("next");
                        if (next == null || (next.isTextual() && next.asText().isEmpty())) step.putNull("next");
                        else step.set("next", next);
                        steps.add(step);
                    }
                }
            }
        }
        if (steps != null) bundle.putObject("workflow").set("steps", steps);
        else bundle.putNull("workflow");

        // widgets = distinct step widget names, enriched from the component/form registry
        ArrayNode widgets = bundle.putArray("widgets");
        Set<String> names = new LinkedHashSet<>();
        if (steps != null) for (JsonNode s : steps) names.add(s.get("widget").asText());
        for (String name : names) {
            Capability cap = caps.findFirstByTenantIdAndNameAndSoftDeletedAtIsNull(tenant, name).orElse(null);
            ObjectNode w = widgets.addObject();
            w.put("name", name);
            w.put("kind", cap != null ? cap.kind : "component");
            if (cap != null) {
                JsonNode ps = json.read(cap.body).get("propsSchema");
                if (ps != null) w.set("propsSchema", ps);
            }
        }
        bundle.put("publishedVersionNo", versionNo);
        bundle.put("publishedAt", publishedAt.toString());
        return json.write(bundle);
    }

    private String firstRequireName(JsonNode requires, String kind) {
        for (JsonNode r : requires) {
            if (kind.equalsIgnoreCase(r.path("kind").asText()) && r.hasNonNull("name")) return r.get("name").asText();
        }
        return null;
    }
}
