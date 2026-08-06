package com.acme.catalog.service;

import com.acme.catalog.domain.Capability;
import com.acme.catalog.domain.Experience;
import com.acme.catalog.repo.CapabilityRepository;
import com.acme.catalog.support.Json;
import tools.jackson.databind.JsonNode;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Resolves an experience's requirements against the tenant catalog (the /plan
 * dry-run), including one level of transitive references so forms/workflows
 * surface their field/step bindings as dependencies. Ports
 * resolveExperienceRequirements (experience-repo.ts).
 */
@Service
public class PlanService {
    public record Ref(String kind, String name, String tag, String via) {}
    public record Result(List<Ref> matched, List<Ref> unmet) {
        public boolean complete() { return unmet.isEmpty(); }
    }

    private final CapabilityRepository caps;
    private final Json json;

    public PlanService(CapabilityRepository caps, Json json) { this.caps = caps; this.json = json; }

    public Result resolve(String tenant, Experience exp) {
        List<Ref> matched = new ArrayList<>();
        List<Ref> unmet = new ArrayList<>();
        Set<String> namesSeen = new HashSet<>();
        JsonNode requires = json.read(exp.body).path("requires");

        // ── direct requires ──
        for (JsonNode req : requires) {
            String kind = text(req, "kind");
            String name = text(req, "name");
            String tag = text(req, "tag");
            boolean optional = req.path("optional").asBoolean(false);
            if (name != null) {
                namesSeen.add(name);
                if (caps.existsByTenantIdAndKindIgnoreCaseAndNameAndSoftDeletedAtIsNull(tenant, kind, name))
                    matched.add(new Ref(kind, name, null, null));
                else if (!optional) unmet.add(new Ref(kind, name, null, null));
            } else if (tag != null) {
                List<Capability> hits = caps.findByTenantIdAndKindAndSoftDeletedAtIsNullOrderByName(tenant, kind).stream()
                        .filter(c -> json.readStringList(c.tags).contains(tag)).toList();
                if (!hits.isEmpty()) hits.forEach(c -> matched.add(new Ref(kind, c.name, null, null)));
                else if (!optional) unmet.add(new Ref(kind, null, tag, null));
            } else if (!optional) {
                unmet.add(new Ref(kind, null, null, null));
            }
        }

        // ── transitive: form fields + workflow steps ──
        for (JsonNode req : requires) {
            String name = text(req, "name");
            if (name == null) continue;
            String kind = text(req, "kind");
            if ("form".equalsIgnoreCase(kind)) {
                caps.findFirstByTenantIdAndKindIgnoreCaseAndNameAndSoftDeletedAtIsNull(tenant, "form", name).ifPresent(cap -> {
                    for (JsonNode f : json.read(cap.body).path("schema").path("fields")) {
                        addRef(tenant, List.of("component"), text(f, "widget"), name, namesSeen, matched, unmet);
                        addRef(tenant, List.of("datasource", "tool"), text(f, "source"), name, namesSeen, matched, unmet);
                        for (JsonNode v : f.path("validators")) addRef(tenant, List.of("validation"), v.asText(null), name, namesSeen, matched, unmet);
                    }
                });
            } else if ("workflow".equalsIgnoreCase(kind)) {
                caps.findFirstByTenantIdAndKindIgnoreCaseAndNameAndSoftDeletedAtIsNull(tenant, "workflow", name).ifPresent(cap -> {
                    JsonNode body = json.read(cap.body);
                    JsonNode steps = body.path("workflow").has("steps") ? body.path("workflow").path("steps") : body.path("steps");
                    for (JsonNode s : steps) addRef(tenant, List.of("component"), text(s, "widget"), name, namesSeen, matched, unmet);
                });
            }
        }
        return new Result(matched, unmet);
    }

    private void addRef(String tenant, List<String> kinds, String name, String via,
                        Set<String> seen, List<Ref> matched, List<Ref> unmet) {
        if (name == null || name.isBlank() || seen.contains(name)) return;
        seen.add(name);
        Capability found = caps.findFirstByTenantIdAndNameAndKindInAndSoftDeletedAtIsNull(tenant, name, kinds).orElse(null);
        if (found != null) matched.add(new Ref(found.kind, name, null, via));
        else unmet.add(new Ref(kinds.get(0), name, null, via));
    }

    private static String text(JsonNode n, String field) {
        return n.hasNonNull(field) && !n.get(field).asText().isEmpty() ? n.get(field).asText() : null;
    }
}
